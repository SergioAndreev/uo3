import { compareLevels, hasAccess, isStaff, type AccessLevel } from '@duskmarch/domain';
import { EngineError } from './errors.js';
import { CLOSE, CloseError, type ClientLink } from './session.js';
import type { Scheduler } from './scheduler.js';

export interface PresenceEntry {
  characterId: string;
  entityId: number;
  characterName: string;
  accountId: string;
  realm: string;
  partitionId: string;
  status: 'online' | 'lingering';
  accessLevel: AccessLevel;
  effectiveLevel: AccessLevel;
  stealth: boolean;
  connectedAtMs: number;
}

export type Severity = 'info' | 'warning' | 'critical' | 'maintenance' | 'shutdown_countdown';
export interface Announcement {
  id: string;
  severity: Severity;
  displayMode: 'chat' | 'banner' | 'both';
  text: string;
  localeKey?: string;
  scope: { kind: 'all' } | { kind: 'realm'; realm: string } | { kind: 'staff_only' };
  pinned: boolean;
  expiresAtMs: number | null;
  createdAtMs: number;
}

export interface HubClaims {
  accountId: string;
  characterId: string;
  entityId: number;
  accessLevel: AccessLevel;
  effectiveLevel: AccessLevel;
}

interface HubConnection {
  client: ClientLink;
  claims: HubClaims;
}

export interface HubPorts {
  redeem(token: string): Promise<{ ok: true; claims: HubClaims } | { ok: false }>;
  audit(action: string, data: Record<string, unknown>): void;
  newId(): string;
}

/** Обработчик расширения хаба (P26: чаты, гильдии). */
export interface HubExtension {
  validate(payload: unknown): boolean;
  handle(ctx: HubClaims, payload: unknown): void;
}

const MAX_TEXT = 512;
const PINNED_CAP = 20;
const ANNOUNCE_PER_MINUTE = 10;

/** Ядро комнаты хаба: присутствие, скрытность, объявления, MOTD. */
export class HubCore {
  private readonly connections = new Map<string, HubConnection>();
  private readonly byClient = new Map<string, string>();
  private readonly presence = new Map<string, PresenceEntry>();
  private pinned: Announcement[] = [];
  private readonly sentBy = new Map<string, number[]>();
  private readonly extensions = new Map<string, HubExtension>();
  private lastSummaryMs = -Infinity;
  private summaryPending = false;
  motd = '';

  constructor(
    private readonly scheduler: Scheduler,
    private readonly ports: HubPorts,
  ) {}

  private now(): number {
    return this.scheduler.timeMs;
  }

  async join(client: ClientLink, ticket: string): Promise<HubClaims> {
    const redeemed = await this.ports.redeem(ticket);
    if (!redeemed.ok) throw new CloseError(CLOSE.INVALID_TICKET, 'билет хаба недействителен');
    const claims = redeemed.claims;
    const old = this.connections.get(claims.accountId);
    if (old) {
      this.byClient.delete(old.client.id);
      old.client.close(CLOSE.DUPLICATE_SESSION, 'новое соединение хаба');
    }
    this.connections.set(claims.accountId, { client, claims });
    this.byClient.set(client.id, claims.accountId);
    client.send('hub:motd', { text: this.motd });
    for (const a of this.activePinned())
      if (this.reaches(a, claims)) client.send('hub:announcement', a);
    client.send('hub:presence_summary', { onlineCount: this.visibleCount(claims.effectiveLevel) });
    return claims;
  }

  leave(clientId: string): void {
    const account = this.byClient.get(clientId);
    if (account === undefined) return;
    this.byClient.delete(clientId);
    this.connections.delete(account);
  }

  connected(accountId: string): boolean {
    return this.connections.has(accountId);
  }

  // ── Присутствие ───────────────────────────────────────────────

  /** `session.entered` и смена партиции. */
  entered(
    e: Omit<PresenceEntry, 'status' | 'stealth' | 'connectedAtMs'> & { stealth?: boolean },
  ): void {
    const prev = this.presence.get(e.accountId);
    this.presence.set(e.accountId, {
      ...e,
      status: 'online',
      stealth: (e.stealth ?? prev?.stealth ?? false) && isStaff(e.effectiveLevel),
      connectedAtMs: prev?.connectedAtMs ?? this.now(),
    });
    this.scheduleSummary();
  }

  lingering(accountId: string): void {
    const entry = this.presence.get(accountId);
    if (entry) entry.status = 'lingering';
  }

  exited(accountId: string): void {
    if (this.presence.delete(accountId)) this.scheduleSummary();
  }

  /** Сверка с живым реестром партиций: записи упавших партиций удаляются. */
  reconcile(livePartitions: ReadonlySet<string>): number {
    let removed = 0;
    for (const [account, entry] of this.presence) {
      if (!livePartitions.has(entry.partitionId)) {
        this.presence.delete(account);
        removed++;
      }
    }
    if (removed) this.scheduleSummary();
    return removed;
  }

  setStealth(accountId: string, stealth: boolean): void {
    const entry = this.presence.get(accountId);
    if (entry) {
      entry.stealth = stealth && isStaff(entry.effectiveLevel);
      this.scheduleSummary();
    }
  }

  /** Смена уровней: скрытность снимается, если эффективный уровень больше не персонал. */
  levelsChanged(accountId: string, accessLevel: AccessLevel, effectiveLevel: AccessLevel): void {
    const entry = this.presence.get(accountId);
    if (entry) {
      entry.accessLevel = accessLevel;
      entry.effectiveLevel = effectiveLevel;
      if (!isStaff(effectiveLevel)) entry.stealth = false;
    }
    const conn = this.connections.get(accountId);
    if (conn) conn.claims = { ...conn.claims, accessLevel, effectiveLevel };
    this.scheduleSummary();
  }

  /** Виден ли персонаж наблюдателю: скрытый сотрудник — только для уровня не ниже его. */
  private visibleTo(entry: PresenceEntry, viewer: AccessLevel): boolean {
    return !entry.stealth || compareLevels(viewer, entry.effectiveLevel) >= 0;
  }

  visibleCount(viewer: AccessLevel): number {
    let n = 0;
    for (const e of this.presence.values()) if (this.visibleTo(e, viewer)) n++;
    return n;
  }

  /** Точечный запрос присутствия по списку героев. */
  query(
    characterIds: readonly string[],
    viewer: AccessLevel,
  ): Record<string, 'online' | 'lingering' | 'offline'> {
    const wanted = new Set(characterIds);
    const out: Record<string, 'online' | 'lingering' | 'offline'> = {};
    for (const id of characterIds) out[id] = 'offline';
    for (const e of this.presence.values()) {
      if (wanted.has(e.characterId) && this.visibleTo(e, viewer)) out[e.characterId] = e.status;
    }
    return out;
  }

  /** Сводка онлайна не чаще раза в секунду. */
  private scheduleSummary(): void {
    if (this.summaryPending) return;
    const wait = Math.max(0, this.lastSummaryMs + 1_000 - this.now());
    this.summaryPending = true;
    this.scheduler.after(wait, () => {
      this.summaryPending = false;
      this.lastSummaryMs = this.now();
      for (const { client, claims } of this.connections.values()) {
        client.send('hub:presence_summary', {
          onlineCount: this.visibleCount(claims.effectiveLevel),
        });
      }
    });
  }

  // ── Объявления ────────────────────────────────────────────────

  private reaches(a: Announcement, claims: HubClaims): boolean {
    if (a.scope.kind === 'staff_only') return hasAccess(claims.accessLevel, 'helper');
    if (a.scope.kind === 'realm')
      return this.presence.get(claims.accountId)?.realm === a.scope.realm;
    return true;
  }

  private activePinned(): Announcement[] {
    const now = this.now();
    return this.pinned.filter((a) => a.expiresAtMs === null || now < a.expiresAtMs);
  }

  /** Системное объявление (хост, обслуживание, обратный отсчёт). */
  announce(input: Omit<Announcement, 'id' | 'createdAtMs'>): Announcement {
    const text = input.text.trim();
    if (text.length === 0 || [...input.text].length > MAX_TEXT) {
      throw new EngineError('HUB_ANNOUNCEMENT_INVALID', `текст 1–${MAX_TEXT} символов`);
    }
    const a: Announcement = { ...input, id: this.ports.newId(), createdAtMs: this.now() };
    if (a.pinned) {
      this.pinned = [...this.pinned, a].slice(-PINNED_CAP);
    }
    for (const { client, claims } of this.connections.values()) {
      if (this.reaches(a, claims)) client.send('hub:announcement', a);
    }
    return a;
  }

  get pinnedCount(): number {
    return this.pinned.length;
  }

  /** Ручное объявление сотрудника: права, частота, аудит. */
  staffAnnounce(sender: HubClaims, input: Omit<Announcement, 'id' | 'createdAtMs'>): Announcement {
    if (!hasAccess(sender.effectiveLevel, 'game-master')) {
      this.ports.audit('hub.announce.denied', { accountId: sender.accountId });
      throw new EngineError('HUB_ANNOUNCEMENT_FORBIDDEN', 'нужен уровень game-master');
    }
    const now = this.now();
    const recent = (this.sentBy.get(sender.accountId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= ANNOUNCE_PER_MINUTE) {
      throw new EngineError('HUB_ANNOUNCEMENT_RATE_LIMITED', 'не больше 10 объявлений в минуту');
    }
    const a = this.announce(input);
    this.sentBy.set(sender.accountId, [...recent, now]);
    this.ports.audit('hub.announce', {
      accountId: sender.accountId,
      id: a.id,
      severity: a.severity,
    });
    return a;
  }

  // ── Безопасность и расширения ─────────────────────────────────

  /** Бан, отзыв сессий, блокировка; обслуживание — для неперсонала. */
  disconnect(accountId: string, code: number, reason: string): void {
    const conn = this.connections.get(accountId);
    if (!conn) return;
    this.connections.delete(accountId);
    this.byClient.delete(conn.client.id);
    conn.client.close(code, reason);
  }

  maintenance(): number {
    let n = 0;
    for (const [account, { claims }] of [...this.connections]) {
      if (!hasAccess(claims.accessLevel, 'game-master')) {
        this.disconnect(account, CLOSE.SHARD_MAINTENANCE, 'обслуживание');
        n++;
      }
    }
    return n;
  }

  registerExtension(type: string, extension: HubExtension): void {
    this.extensions.set(type, extension);
  }

  /** Сообщение клиента: в расширение с доверенным контекстом; невалидное — отказ. */
  message(clientId: string, type: string, payload: unknown): boolean {
    const account = this.byClient.get(clientId);
    const conn = account === undefined ? undefined : this.connections.get(account);
    const ext = this.extensions.get(type);
    if (!conn || !ext || !ext.validate(payload)) return false;
    ext.handle(conn.claims, payload);
    return true;
  }
}
