import { hasAccess, isStaff, type AccessLevel, type EntityId } from '@duskmarch/domain';
import type { TimerHandle } from './timing-wheel.js';
import type { PartitionCore } from './partition.js';
import type { Scheduler } from './scheduler.js';

/** Коды закрытия из реестра протокола. */
export const CLOSE = {
  INVALID_TICKET: 4101,
  BANNED: 4103,
  DUPLICATE_SESSION: 4104,
  CHARACTER_NOT_FOUND: 4105,
  PARTITION_FULL: 4106,
  IDLE_TIMEOUT: 4109,
  SERVER_SHUTDOWN: 4112,
  LOGOUT_COMPLETE: 4122,
  SESSION_REVOKED: 4123,
  ACCOUNT_ALREADY_IN_WORLD: 4124,
  CHARACTER_LOCKED: 4125,
  CHARACTER_FORCE_RENAME: 4126,
  SHARD_MAINTENANCE: 4127,
  PARTITION_NOT_READY: 4128,
} as const;

/** Отказ подключения с кодом закрытия. */
export class CloseError extends Error {
  override readonly name = 'CloseError';
  constructor(
    readonly code: number,
    reason: string,
  ) {
    super(reason);
  }
}

/** Соединение клиента (WebSocket Colyseus или виртуальный клиент стенда). */
export interface ClientLink {
  readonly id: string;
  send(type: string, payload: unknown): void;
  close(code: number, reason: string): void;
}

/** Доверенные атрибуты из погашенного билета P05. */
export interface TicketClaims {
  accountId: string;
  characterId: string;
  entityId: number;
  name: string;
  accessLevel: AccessLevel;
  effectiveLevel: AccessLevel;
  realm: string;
  x: number;
  y: number;
  h: number;
  takeover: boolean;
}

export interface HeroRecord {
  status: 'active' | 'rename_required' | 'locked' | 'pending_deletion' | 'deleted';
  realm: string;
  x: number;
  y: number;
  h: number;
  vitals: { health: number; verve: number; resonance: number };
}

export interface HeroSave {
  realm: string;
  x: number;
  y: number;
  h: number;
  vitals: { health: number; verve: number; resonance: number };
  playtimeDeltaS: number;
}

export interface SessionRecord {
  characterId: string;
  entityId: number;
  worldRoomId: string;
  nodeId: string;
  sessionId: string;
  state: 'online' | 'logout_delay';
  updatedAt: number;
}

/** Порты сессий; в работе — Valkey, PostgreSQL и мир P03, в стенде — память. */
export interface SessionPorts {
  redeem(token: string): Promise<{ ok: true; claims: TicketClaims } | { ok: false }>;
  loadHero(characterId: string): Promise<HeroRecord | null>;
  saveHero(characterId: string, save: HeroSave): Promise<void>;
  /** Захват шардовой записи: `claimed` или запись другого героя аккаунта. */
  claim(accountId: string, record: SessionRecord): Promise<'claimed' | SessionRecord>;
  updateSession(accountId: string, record: SessionRecord): Promise<void>;
  /** Удаляет запись, только если `sessionId` совпадает. */
  release(accountId: string, sessionId: string): Promise<void>;
  /** Ближайшая точка, где герой может стоять; `null` — точка уже допустима. */
  resolveSpawn(
    realm: string,
    x: number,
    y: number,
    h: number,
  ): { x: number; y: number; h: number } | null;
  isSafeZone(realm: string, x: number, y: number): boolean;
  publish(subject: string, payload: Record<string, unknown>): void;
  newToken(): string;
  warn(message: string, data: Record<string, unknown>): void;
}

/** Подсистема (бой, нарушения) может запретить мгновенный выход. */
export type LogoutPolicy = (entityId: EntityId) => boolean;

export type SessionState =
  'ONLINE' | 'RECONNECT_WINDOW' | 'LOGOUT_DELAY' | 'HANDOFF_OUT' | 'EXITED';

export interface Session {
  sessionId: string;
  accountId: string;
  characterId: string;
  entityId: EntityId;
  name: string;
  accessLevel: AccessLevel;
  effectiveLevel: AccessLevel;
  realm: string;
  state: SessionState;
  client: ClientLink | null;
  vitals: HeroSave['vitals'];
  reconnectToken: string | null;
  onlineSinceMs: number | null;
  playtimeMs: number;
  timers: {
    reconnect?: TimerHandle;
    logout?: TimerHandle;
    idle?: TimerHandle;
    handoff?: TimerHandle;
  };
}

export interface SessionOptions {
  nodeId: string;
  roomId: string;
  logoutDelayMs: number;
  reconnectWindowMs?: number;
  idleTimeoutMs?: number;
  handoffTimeoutMs?: number;
}

/** Жизненный цикл сессий героев одной комнаты партиции. */
export class SessionManager {
  private readonly byAccount = new Map<string, Session>();
  private readonly byClient = new Map<string, Session>();
  private readonly policies: LogoutPolicy[] = [];
  private seq = 0;

  constructor(
    private readonly partition: PartitionCore,
    private readonly scheduler: Scheduler,
    private readonly ports: SessionPorts,
    private readonly o: SessionOptions,
  ) {}

  addLogoutPolicy(policy: LogoutPolicy): void {
    this.policies.push(policy);
  }

  get count(): number {
    return this.byAccount.size;
  }

  session(accountId: string): Session | undefined {
    return this.byAccount.get(accountId);
  }

  ofClient(clientId: string): Session | undefined {
    return this.byClient.get(clientId);
  }

  private now(): number {
    return this.scheduler.timeMs;
  }

  private record(s: Session): SessionRecord {
    return {
      characterId: s.characterId,
      entityId: s.entityId,
      worldRoomId: this.o.roomId,
      nodeId: this.o.nodeId,
      sessionId: s.sessionId,
      state:
        s.state === 'LOGOUT_DELAY' || s.state === 'RECONNECT_WINDOW' ? 'logout_delay' : 'online',
      updatedAt: this.now(),
    };
  }

  private cancelTimers(
    s: Session,
    which: (keyof Session['timers'])[] = ['reconnect', 'logout', 'idle', 'handoff'],
  ): void {
    for (const key of which) {
      const handle = s.timers[key];
      if (handle) this.scheduler.cancel(handle);
      delete s.timers[key];
    }
  }

  private enterOnline(s: Session): void {
    s.state = 'ONLINE';
    s.onlineSinceMs = this.now();
    this.touch(s);
  }

  private leaveOnline(s: Session): void {
    if (s.onlineSinceMs !== null) s.playtimeMs += this.now() - s.onlineSinceMs;
    s.onlineSinceMs = null;
  }

  /** Новое соединение получает свежий токен переподключения заранее: после обрыва его не доставить. */
  private bind(s: Session, client: ClientLink): void {
    if (s.client) this.byClient.delete(s.client.id);
    s.client = client;
    this.byClient.set(client.id, s);
    s.reconnectToken = this.ports.newToken();
    client.send('session:reconnect_token', { sessionId: s.sessionId, token: s.reconnectToken });
  }

  private unbind(s: Session): ClientLink | null {
    const client = s.client;
    if (client) this.byClient.delete(client.id);
    s.client = null;
    return client;
  }

  /** Отсчёт бездействия; персонал не отключается. */
  touch(s: Session): void {
    const idle = this.o.idleTimeoutMs ?? 30 * 60_000;
    this.cancelTimers(s, ['idle']);
    if (idle <= 0 || isStaff(s.accessLevel) || s.state !== 'ONLINE') return;
    s.timers.idle = this.scheduler.after(idle, () => this.logout(s, CLOSE.IDLE_TIMEOUT));
  }

  /** Вход по билету P05. Бросает `CloseError` с кодом реестра. */
  async join(client: ClientLink, ticket: string): Promise<Session> {
    if (this.partition.state !== 'ACTIVE')
      throw new CloseError(CLOSE.PARTITION_NOT_READY, 'партиция загружается');
    const redeemed = await this.ports.redeem(ticket);
    if (!redeemed.ok) throw new CloseError(CLOSE.INVALID_TICKET, 'билет недействителен');
    const c = redeemed.claims;
    const existing = this.byAccount.get(c.accountId);
    if (existing && existing.state !== 'EXITED') {
      if (existing.characterId !== c.characterId) {
        throw new CloseError(CLOSE.ACCOUNT_ALREADY_IN_WORLD, 'в мире другой герой аккаунта');
      }
      return this.takeover(existing, client, c);
    }
    const hero = await this.ports.loadHero(c.characterId);
    if (!hero || hero.status === 'deleted' || hero.status === 'pending_deletion') {
      throw new CloseError(CLOSE.CHARACTER_NOT_FOUND, 'герой недоступен');
    }
    if (hero.status === 'locked')
      throw new CloseError(CLOSE.CHARACTER_LOCKED, 'герой заблокирован');
    if (hero.status === 'rename_required')
      throw new CloseError(CLOSE.CHARACTER_FORCE_RENAME, 'нужно новое имя');
    if (!this.partition.admits(c.accessLevel))
      throw new CloseError(CLOSE.PARTITION_FULL, 'партиция заполнена');
    const sessionId = `${this.o.nodeId}:${++this.seq}`;
    const s: Session = {
      sessionId,
      accountId: c.accountId,
      characterId: c.characterId,
      entityId: c.entityId as EntityId,
      name: c.name,
      accessLevel: c.accessLevel,
      effectiveLevel: c.effectiveLevel,
      realm: c.realm,
      state: 'ONLINE',
      client: null,
      vitals: { ...hero.vitals },
      reconnectToken: null,
      onlineSinceMs: null,
      playtimeMs: 0,
      timers: {},
    };
    const claim = await this.ports.claim(c.accountId, this.record(s));
    if (claim !== 'claimed')
      throw new CloseError(CLOSE.ACCOUNT_ALREADY_IN_WORLD, 'аккаунт уже в мире');
    let { x, y, h } = c;
    if (!this.partition.contains(x, y)) ({ x, y, h } = hero);
    const fixed = this.partition.contains(x, y) ? this.ports.resolveSpawn(c.realm, x, y, h) : null;
    if (fixed) {
      this.ports.warn('session: точка появления исправлена', {
        characterId: c.characterId,
        from: { x, y, h },
        to: fixed,
      });
      ({ x, y, h } = fixed);
    }
    if (!this.partition.contains(x, y)) {
      await this.ports.release(c.accountId, sessionId);
      throw new CloseError(CLOSE.CHARACTER_NOT_FOUND, 'точка появления вне партиции');
    }
    this.partition.spawn({
      id: s.entityId,
      kind: 'hero',
      placement: { kind: 'world', x, y, h },
      player: true,
      height: 7,
      blocksSight: false,
      behaviors: [],
    });
    this.byAccount.set(c.accountId, s);
    this.bind(s, client);
    this.enterOnline(s);
    client.send('session:ready', { sessionId, entityId: s.entityId, realm: s.realm, x, y, h });
    this.ports.publish('session.entered', {
      accountId: s.accountId,
      characterId: s.characterId,
      entityId: s.entityId,
      name: s.name,
      realm: s.realm,
      partitionId: this.partition.id,
      accessLevel: s.accessLevel,
      effectiveLevel: s.effectiveLevel,
    });
    return s;
  }

  /** Перехват своей сессии: старое соединение — 4104, таймеры отменены, сущность та же. */
  private async takeover(s: Session, client: ClientLink, c: TicketClaims): Promise<Session> {
    const old = this.unbind(s);
    old?.close(CLOSE.DUPLICATE_SESSION, 'вход с другого устройства');
    this.cancelTimers(s);
    s.accessLevel = c.accessLevel;
    s.effectiveLevel = c.effectiveLevel;
    this.bind(s, client);
    if (s.state !== 'ONLINE') this.enterOnline(s);
    await this.ports.updateSession(s.accountId, this.record(s));
    const pos = this.partition.get(s.entityId)?.placement;
    client.send('session:ready', {
      sessionId: s.sessionId,
      entityId: s.entityId,
      realm: s.realm,
      ...(pos?.kind === 'world' ? { x: pos.x, y: pos.y, h: pos.h } : {}),
    });
    return s;
  }

  /** Обрыв соединения: окно переподключения и параллельно отсчёт задержки выхода. */
  disconnect(clientId: string): void {
    const s = this.byClient.get(clientId);
    if (!s) return;
    this.unbind(s);
    if (s.state !== 'ONLINE') return;
    this.leaveOnline(s);
    this.cancelTimers(s, ['idle']);
    s.state = 'RECONNECT_WINDOW';
    s.timers.reconnect = this.scheduler.after(this.o.reconnectWindowMs ?? 30_000, () => {
      s.reconnectToken = null;
      if (s.state === 'RECONNECT_WINDOW') s.state = 'LOGOUT_DELAY';
      delete s.timers.reconnect;
    });
    s.timers.logout = this.scheduler.after(this.o.logoutDelayMs, () => void this.exit(s));
    void this.ports.updateSession(s.accountId, this.record(s));
  }

  reconnect(client: ClientLink, accountId: string, sessionId: string, token: string): Session {
    const s = this.byAccount.get(accountId);
    if (
      !s ||
      s.sessionId !== sessionId ||
      s.state !== 'RECONNECT_WINDOW' ||
      s.reconnectToken !== token
    ) {
      throw new CloseError(CLOSE.INVALID_TICKET, 'токен переподключения недействителен');
    }
    this.cancelTimers(s, ['reconnect', 'logout']);
    this.bind(s, client);
    this.enterOnline(s);
    void this.ports.updateSession(s.accountId, this.record(s));
    return s;
  }

  /** Запрос выхода (или выход по бездействию с кодом 4109). */
  logout(s: Session, code: number = CLOSE.LOGOUT_COMPLETE): void {
    if (s.state === 'EXITED' || s.state === 'LOGOUT_DELAY') return;
    const pos = this.partition.get(s.entityId)?.placement;
    const safe = pos?.kind === 'world' && this.ports.isSafeZone(s.realm, pos.x, pos.y);
    const blocked = this.policies.some((p) => p(s.entityId));
    const instant = hasAccess(s.accessLevel, 'helper') || (safe && !blocked);
    if (instant) {
      this.unbind(s)?.close(code, JSON.stringify({ delayed: false }));
      void this.exit(s);
      return;
    }
    if (safe && blocked)
      s.client?.send('session:logout_pending', { reason: 'policy', delayMs: this.o.logoutDelayMs });
    this.unbind(s)?.close(code, JSON.stringify({ delayed: true }));
    this.leaveOnline(s);
    this.cancelTimers(s);
    s.state = 'LOGOUT_DELAY';
    s.timers.logout = this.scheduler.after(this.o.logoutDelayMs, () => void this.exit(s));
    void this.ports.updateSession(s.accountId, this.record(s));
  }

  /** Сохранение, выгрузка, освобождение шардовой записи. */
  async exit(s: Session): Promise<void> {
    if (s.state === 'EXITED') return;
    this.leaveOnline(s);
    this.cancelTimers(s);
    const prevState = s.state;
    s.state = 'EXITED';
    const pos = this.partition.get(s.entityId)?.placement;
    const save: HeroSave = {
      realm: s.realm,
      x: pos?.kind === 'world' ? pos.x : 0,
      y: pos?.kind === 'world' ? pos.y : 0,
      h: pos?.kind === 'world' ? pos.h : 0,
      vitals: { ...s.vitals },
      playtimeDeltaS: Math.round(s.playtimeMs / 1000),
    };
    s.playtimeMs = 0;
    this.partition.despawn(s.entityId);
    this.unbind(s);
    this.byAccount.delete(s.accountId);
    if (pos?.kind === 'world') await this.ports.saveHero(s.characterId, save);
    if (prevState !== 'HANDOFF_OUT') await this.ports.release(s.accountId, s.sessionId);
    this.ports.publish('session.exited', {
      accountId: s.accountId,
      characterId: s.characterId,
      partitionId: this.partition.id,
    });
  }

  /** Бан, блокировка — немедленно; отзыв сессий и переименование — через задержку выхода. */
  async securityEvent(
    accountId: string,
    kind: 'banned' | 'locked' | 'sessions_revoked' | 'rename_required',
    characterId?: string,
  ): Promise<void> {
    const s = this.byAccount.get(accountId);
    if (!s || (characterId !== undefined && s.characterId !== characterId)) return;
    const code = {
      banned: CLOSE.BANNED,
      locked: CLOSE.CHARACTER_LOCKED,
      sessions_revoked: CLOSE.SESSION_REVOKED,
      rename_required: CLOSE.CHARACTER_FORCE_RENAME,
    }[kind];
    if (kind === 'banned' || kind === 'locked') {
      this.unbind(s)?.close(code, kind);
      await this.exit(s);
      return;
    }
    if (s.state === 'LOGOUT_DELAY') return;
    const client = this.unbind(s);
    client?.close(code, kind);
    if (s.state === 'ONLINE') this.leaveOnline(s);
    this.cancelTimers(s, ['reconnect', 'idle']);
    s.reconnectToken = null;
    s.state = 'LOGOUT_DELAY';
    s.timers.logout ??= this.scheduler.after(this.o.logoutDelayMs, () => void this.exit(s));
    await this.ports.updateSession(s.accountId, this.record(s));
  }

  /** Смена уровней на лету; потеря допуска к обслуживанию — 4127. */
  async accessChanged(
    accountId: string,
    accessLevel: AccessLevel,
    effectiveLevel: AccessLevel,
    maintenance: boolean,
  ): Promise<void> {
    const s = this.byAccount.get(accountId);
    if (!s) return;
    s.accessLevel = accessLevel;
    s.effectiveLevel = effectiveLevel;
    if (maintenance && !hasAccess(accessLevel, 'game-master')) {
      this.unbind(s)?.close(CLOSE.SHARD_MAINTENANCE, 'обслуживание');
      await this.exit(s);
      return;
    }
    this.touch(s);
  }

  /** Обслуживание шарда: обычные игроки отключаются с 4127. */
  async maintenance(): Promise<number> {
    let kicked = 0;
    for (const s of [...this.byAccount.values()]) {
      if (hasAccess(s.accessLevel, 'game-master')) continue;
      this.unbind(s)?.close(CLOSE.SHARD_MAINTENANCE, 'обслуживание');
      await this.exit(s);
      kicked++;
    }
    return kicked;
  }

  /** Остановка узла: всем 4112, финальное сохранение. */
  async shutdown(): Promise<void> {
    for (const s of [...this.byAccount.values()]) {
      this.unbind(s)?.close(CLOSE.SERVER_SHUTDOWN, 'остановка сервера');
      await this.exit(s);
    }
  }

  /** Передача в другую партицию: подтверждение — выгрузка без задержки выхода; отказ или таймаут — назад в ONLINE. */
  beginHandoff(s: Session, confirm: () => Promise<boolean>): Promise<boolean> {
    if (s.state !== 'ONLINE') return Promise.resolve(false);
    s.state = 'HANDOFF_OUT';
    return new Promise((resolve) => {
      let settled = false;
      const finish = async (ok: boolean) => {
        if (settled) return;
        settled = true;
        this.cancelTimers(s, ['handoff']);
        if (ok) {
          this.leaveOnline(s);
          await this.exit(s);
        } else {
          s.state = 'ONLINE';
        }
        resolve(ok);
      };
      s.timers.handoff = this.scheduler.after(
        this.o.handoffTimeoutMs ?? 5_000,
        () => void finish(false),
      );
      void confirm().then(finish, () => finish(false));
    });
  }
}
