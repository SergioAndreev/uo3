import { randomUUID } from 'node:crypto';
import { hasAccess, type AccessLevel, type EntityId, type IdAllocator } from '@duskmarch/domain';
import { AnnounceRequest } from '@duskmarch/protocol';
import { Value } from '@sinclair/typebox/value';
import type { CriticalTransactionCoordinator } from '../persistence/critical.js';
import type { DirtyTracker } from '../persistence/dirty-tracker.js';
import type { FlushCoordinator, WorldRowOut } from '../persistence/flush.js';
import type { TimerStore } from '../persistence/timer-store.js';
import type { WorldClock } from '../persistence/world-clock.js';
import { HubCore, type HubClaims, type HubPorts } from '../engine/hub.js';
import { PartitionCore, type Entity, type PartitionEvent } from '../engine/partition.js';
import type { Rect } from '../engine/spatial-index.js';
import { Scheduler } from '../engine/scheduler.js';
import {
  CLOSE,
  CloseError,
  SessionManager,
  type ClientLink,
  type SessionPorts,
} from '../engine/session.js';

export type NodeRole = 'all' | 'partition' | 'hub';
export type NodeState = 'STARTING' | 'READY' | 'DRAINING' | 'SHUTTING_DOWN' | 'STOPPED';

export interface NodeConfig {
  shardId: string;
  nodeId: string;
  role: NodeRole;
  wsUrl: string;
  heartbeatMs: number;
  logoutDelayMs: number;
  reconnectWindowMs: number;
  idleTimeoutMs: number;
  capacity: number;
  staffBuffer: number;
  motd: string;
  hardTimeoutMs: number;
}

export interface PartitionSpec {
  partitionId: string;
  realm: { key: string; width: number; height: number };
  bounds: Rect;
  allocator: Pick<IdAllocator, 'next'>;
  initial?: Entity[];
  /** Наполнение позже (загрузка из БД P08): до `core.hydrate` вход отклоняется `4128`. */
  deferHydration?: boolean;
}

/** Реестр Valkey (формат P05 `@duskmarch/db/live`). */
export interface LiveRegistry {
  heartbeat(hb: {
    nodeId: string;
    onlineCount: number;
    tickP99Ms: number;
    draining: boolean;
    updatedAt: number;
  }): Promise<void>;
  partition(p: {
    partitionId: string;
    realm: string;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    roomId: string;
    wsUrl: string;
    hardCapacity: number;
    staffBuffer: number;
    onlineCount: number;
    draining: boolean;
    updatedAt: number;
  }): Promise<void>;
  hub(h: {
    roomId: string;
    wsUrl: string;
    hardCapacity: number;
    staffBuffer: number;
    onlineCount: number;
    draining: boolean;
    updatedAt: number;
  }): Promise<void>;
  clear(partitionIds: string[]): Promise<void>;
}

export interface NodePorts {
  registry: LiveRegistry;
  /** Порты сессий для партиции (погашение `world`-билетов этой комнаты, БД, Valkey, мир P03). */
  sessionPorts(partitionId: string): Omit<SessionPorts, 'publish'>;
  hubPorts: HubPorts;
  /** Публикация в шину (NATS) для других узлов. */
  publish(subject: string, payload: Record<string, unknown>): void;
  /** Монотонное настенное время для `updatedAt` реестра. */
  wallNow(): number;
  log(level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>): void;
  /** Финальный сброс состояния мира (P08); по умолчанию нет. */
  finalFlush?(): Promise<void>;
}

/** Слушатели ядра партиции (сетевой слой P07). */
export interface PartitionListener {
  event?(event: PartitionEvent): void;
  dirty?(id: EntityId, reason: string): void;
}

export interface PartitionRuntime {
  partitionId: string;
  listeners: Set<PartitionListener>;
  core: PartitionCore;
  /** Эпоха партиции утрачена: вход и запись запрещены. */
  fenced?: boolean;
  /** Сохранение мира (P08): отметки изменений и фоновая запись. */
  persistence?: {
    tracker: DirtyTracker<WorldRowOut>;
    flush: FlushCoordinator;
    critical?: CriticalTransactionCoordinator;
  };
  sessions: SessionManager;
  roomId: string;
  realm: string;
}

/** Причины отзыва сессий P04, после которых герой покидает мир. */
const KICK_REASONS = new Set([
  'logout_all',
  'password_changed',
  'password_reset',
  'token_reuse',
  'staff_revoke',
  'tfa_reset',
  'email_changed',
  'access_level_changed',
  'banned',
]);

const DEDUPE_CAP = 10_000;

/** Узел шарда: партиции, хаб, события, heartbeat, обслуживание, остановка. Без транспорта. */
export class ShardNode {
  state: NodeState = 'STARTING';
  startedReady = false;
  readonly scheduler: Scheduler;
  readonly partitions = new Map<string, PartitionRuntime>();
  readonly hub: HubCore | null;
  readonly hubRoomId: string;
  maintenance = false;
  /** Действия после финального сохранения при остановке (освобождение аренд P08). */
  readonly stopHooks: (() => Promise<void>)[] = [];
  /** Часы мира и длительные таймеры (P08); без БД не заданы. */
  world?: { clock: WorldClock; timers: TimerStore };
  private readonly seen = new Set<string>();
  private heartbeatTimer: ReturnType<Scheduler['every']> | null = null;

  constructor(
    readonly config: NodeConfig,
    private readonly ports: NodePorts,
    scheduler?: Scheduler,
  ) {
    this.scheduler = scheduler ?? new Scheduler();
    this.hubRoomId = `${config.shardId}-hub`;
    this.hub = config.role === 'partition' ? null : new HubCore(this.scheduler, ports.hubPorts);
    if (this.hub) this.hub.motd = config.motd;
  }

  /** Партиция: проверка границ и гидратация до приёма игроков. */
  addPartition(spec: PartitionSpec): PartitionRuntime {
    if (this.config.role === 'hub') throw new Error('узел хаба не обслуживает партиции');
    const listeners = new Set<PartitionListener>();
    const core = new PartitionCore({
      partitionId: spec.partitionId,
      realm: spec.realm,
      bounds: spec.bounds,
      allocator: spec.allocator,
      hardCapacity: this.config.capacity,
      staffBuffer: this.config.staffBuffer,
      onEvent: (event) => {
        for (const l of listeners) l.event?.(event);
      },
      onDirty: (id, reason) => {
        for (const l of listeners) l.dirty?.(id, reason);
      },
    });
    if (!spec.deferHydration) core.hydrate(spec.initial ?? []);
    const roomId = `${this.config.shardId}-${spec.partitionId}`;
    const base = this.ports.sessionPorts(spec.partitionId);
    const sessions = new SessionManager(
      core,
      this.scheduler,
      {
        ...base,
        publish: (subject, payload) => this.sessionEvent(spec.partitionId, subject, payload),
      },
      {
        nodeId: this.config.nodeId,
        roomId,
        logoutDelayMs: this.config.logoutDelayMs,
        reconnectWindowMs: this.config.reconnectWindowMs,
        idleTimeoutMs: this.config.idleTimeoutMs,
      },
    );
    this.scheduler.register({
      name: `partition:${spec.partitionId}`,
      priority: 100,
      run: (ctx) => core.tick(ctx.tick),
    });
    const runtime: PartitionRuntime = {
      partitionId: spec.partitionId,
      listeners,
      core,
      sessions,
      roomId,
      realm: spec.realm.key,
    };
    this.partitions.set(spec.partitionId, runtime);
    return runtime;
  }

  /** События сессий: хаб этого узла обновляется сразу, остальные узлы — через шину. */
  private sessionEvent(
    partitionId: string,
    subject: string,
    payload: Record<string, unknown>,
  ): void {
    this.applySession(subject, { ...payload, partitionId });
    this.ports.publish(`shard.${this.config.shardId}.${subject}`, {
      ...payload,
      partitionId,
      nodeId: this.config.nodeId,
    });
  }

  private applySession(subject: string, p: Record<string, unknown>): void {
    if (!this.hub) return;
    const account = String(p['accountId']);
    if (subject === 'session.entered') {
      this.hub.entered({
        accountId: account,
        characterId: String(p['characterId']),
        entityId: Number(p['entityId']),
        characterName: String(p['name']),
        realm: String(p['realm']),
        partitionId: String(p['partitionId']),
        accessLevel: p['accessLevel'] as AccessLevel,
        effectiveLevel: p['effectiveLevel'] as AccessLevel,
      });
    } else if (subject === 'session.lingering') this.hub.lingering(account);
    else if (subject === 'session.exited') this.hub.exited(account);
  }

  ready(): void {
    this.state = 'READY';
    this.startedReady = true;
    this.heartbeatTimer = this.scheduler.every(
      this.config.heartbeatMs,
      () => void this.heartbeat(),
      'critical',
    );
    void this.heartbeat();
  }

  get onlineCount(): number {
    let n = 0;
    for (const p of this.partitions.values()) n += p.sessions.count;
    return n;
  }

  get draining(): boolean {
    return this.state === 'DRAINING' || this.state === 'SHUTTING_DOWN';
  }

  async heartbeat(): Promise<void> {
    if (this.state !== 'READY' && this.state !== 'DRAINING') return;
    const updatedAt = this.ports.wallNow();
    const draining = this.draining;
    try {
      await this.ports.registry.heartbeat({
        nodeId: this.config.nodeId,
        onlineCount: this.onlineCount,
        tickP99Ms: this.scheduler.tickP99Ms,
        draining,
        updatedAt,
      });
      for (const [id, p] of this.partitions) {
        await p.sessions.refreshRecords();
        await this.ports.registry.partition({
          partitionId: id,
          realm: p.realm,
          ...p.core.bounds,
          roomId: p.roomId,
          wsUrl: this.config.wsUrl,
          hardCapacity: this.config.capacity,
          staffBuffer: this.config.staffBuffer,
          onlineCount: p.sessions.count,
          draining,
          updatedAt,
        });
      }
      if (this.hub) {
        await this.ports.registry.hub({
          roomId: this.hubRoomId,
          wsUrl: this.config.wsUrl,
          hardCapacity: this.config.capacity * Math.max(1, this.partitions.size),
          staffBuffer: this.config.staffBuffer,
          onlineCount: this.hub.visibleCount('owner'),
          draining,
          updatedAt,
        });
      }
    } catch (error) {
      this.ports.log('warn', 'heartbeat не записан', { error: String(error) });
    }
  }

  // ── Подключения ──────────────────────────────────────────────

  private partition(partitionId: string): PartitionRuntime {
    const p = this.partitions.get(partitionId);
    if (!p) throw new CloseError(CLOSE.CHARACTER_NOT_FOUND, 'партиция не найдена');
    return p;
  }

  private admitting(level: AccessLevel | null): void {
    if (this.draining) throw new CloseError(CLOSE.PARTITION_DRAINING, 'узел останавливается');
    if (this.maintenance && level !== null && !hasAccess(level, 'game-master')) {
      throw new CloseError(CLOSE.SHARD_MAINTENANCE, 'обслуживание');
    }
  }

  async joinWorld(
    partitionId: string,
    client: ClientLink,
    options: {
      ticket?: string;
      reconnect?: { accountId: string; sessionId: string; token: string };
    },
  ) {
    const p = this.partition(partitionId);
    this.admitting(null);
    if (p.fenced) throw new CloseError(CLOSE.EPOCH_FENCED, 'партиция передана другому узлу');
    if (p.persistence?.flush.mode === 'read_only_degraded') {
      throw new CloseError(
        CLOSE.PARTITION_NOT_READY,
        'PERSIST_SERVICE_DEGRADED: сохранение мира недоступно',
      );
    }
    if (options.reconnect) {
      const r = options.reconnect;
      return p.sessions.reconnect(client, r.accountId, r.sessionId, r.token);
    }
    if (!options.ticket) throw new CloseError(CLOSE.INVALID_TICKET, 'нет билета');
    const session = await p.sessions.join(client, options.ticket);
    if (this.maintenance && !hasAccess(session.accessLevel, 'game-master')) {
      client.close(CLOSE.SHARD_MAINTENANCE, 'обслуживание');
      await p.sessions.exit(session);
      throw new CloseError(CLOSE.SHARD_MAINTENANCE, 'обслуживание');
    }
    return session;
  }

  /** Внеочередное сохранение всех партиций узла (ручной запуск через API). */
  async flushAll(): Promise<{
    flushId: string;
    entitiesSaved: number;
    durationMs: number;
    checkpointSeq: number;
  }> {
    const started = performance.now();
    let entitiesSaved = 0;
    let checkpointSeq = 0;
    for (const p of this.partitions.values()) {
      if (!p.persistence) continue;
      entitiesSaved += await p.persistence.flush.flushNow();
      checkpointSeq += p.persistence.flush.metrics.cycles;
    }
    return {
      flushId: randomUUID(),
      entitiesSaved,
      durationMs: performance.now() - started,
      checkpointSeq,
    };
  }

  /** Потеря эпохи партиции: закрытие клиентов кодом `4117` без сохранения. */
  async fence(partitionId: string): Promise<void> {
    const p = this.partitions.get(partitionId);
    if (!p || p.fenced) return;
    p.fenced = true;
    this.ports.log('error', 'эпоха партиции утрачена — партиция остановлена', { partitionId });
    await p.sessions.fence(CLOSE.EPOCH_FENCED);
  }

  leaveWorld(partitionId: string, clientId: string): void {
    this.partitions.get(partitionId)?.sessions.disconnect(clientId);
  }

  /** Сообщение клиента комнаты партиции: очередь планировщика, порядок детерминирован. */
  worldMessage(partitionId: string, clientId: string, type: string, sequence: number): void {
    const p = this.partitions.get(partitionId);
    const s = p?.sessions.ofClient(clientId);
    if (!p || !s) return;
    this.scheduler.enqueue({
      sessionOrder: s.entityId,
      sequence,
      apply: () => {
        if (type === 'session:logout_request') p.sessions.logout(s);
        else p.sessions.touch(s);
      },
    });
  }

  /** Сообщение хаба: ручные объявления персонала и расширения. */
  hubMessage(clientId: string, type: string, payload: unknown): void {
    if (!this.hub) return;
    if (type === 'hub:announce_request') {
      const sender = this.hub.claimsOf(clientId);
      if (!sender || !Value.Check(AnnounceRequest, payload)) return;
      try {
        this.hub.staffAnnounce(sender, payload as Parameters<HubCore['staffAnnounce']>[1]);
      } catch (error) {
        this.ports.log('warn', 'объявление отклонено', { error: String(error) });
      }
      return;
    }
    this.hub.message(clientId, type, payload);
  }

  async joinHub(client: ClientLink, ticket: string): Promise<HubClaims> {
    if (!this.hub) throw new CloseError(CLOSE.INVALID_TICKET, 'хаб не на этом узле');
    this.admitting(null);
    const claims = await this.hub.join(client, ticket);
    if (this.maintenance && !hasAccess(claims.accessLevel, 'game-master')) {
      this.hub.disconnect(claims.accountId, CLOSE.SHARD_MAINTENANCE, 'обслуживание');
    }
    return claims;
  }

  // ── События P04/P05 и других узлов ────────────────────────────

  /** Идемпотентная обработка по `eventId`. */
  async handleEvent(subject: string, event: Record<string, unknown>): Promise<boolean> {
    const id = typeof event['eventId'] === 'string' ? event['eventId'] : null;
    if (id) {
      if (this.seen.has(id)) return false;
      this.seen.add(id);
      if (this.seen.size > DEDUPE_CAP) this.seen.delete(this.seen.values().next().value as string);
    }
    const account = String(event['accountId'] ?? '');
    const prefix = `shard.${this.config.shardId}.`;
    if (subject.startsWith(prefix) && subject.includes('.session.')) {
      if (event['nodeId'] !== this.config.nodeId)
        this.applySession(subject.slice(prefix.length), event);
      return true;
    }
    switch (subject) {
      case 'identity.account.banned':
        for (const p of this.partitions.values()) await p.sessions.securityEvent(account, 'banned');
        this.hub?.disconnect(account, CLOSE.BANNED, 'бан');
        return true;
      case 'identity.account.sessions_revoked': {
        if (!KICK_REASONS.has(String(event['reason']))) return true;
        for (const p of this.partitions.values())
          await p.sessions.securityEvent(account, 'sessions_revoked');
        this.hub?.disconnect(account, CLOSE.SESSION_REVOKED, 'сессии отозваны');
        return true;
      }
      case 'identity.account.access_level_changed':
      case 'identity.account.effective_level_changed': {
        const max = (event['newLevel'] ?? event['maxLevel']) as AccessLevel;
        const eff = (event['effectiveLevel'] ?? event['newLevel']) as AccessLevel;
        for (const p of this.partitions.values())
          await p.sessions.accessChanged(account, max, eff, this.maintenance);
        this.hub?.levelsChanged(account, max, eff);
        return true;
      }
      case 'character.locked':
      case 'character.rename_required': {
        if (event['shardId'] !== this.config.shardId) return true;
        const kind = subject === 'character.locked' ? 'locked' : 'rename_required';
        for (const p of this.partitions.values())
          await p.sessions.securityEvent(account, kind, String(event['characterId']));
        if (kind === 'locked')
          this.hub?.disconnect(account, CLOSE.CHARACTER_LOCKED, 'герой заблокирован');
        return true;
      }
      case `shard.${this.config.shardId}.status_changed`:
        await this.shardStatus(String(event['status']));
        return true;
      default:
        return false;
    }
  }

  private async shardStatus(status: string): Promise<void> {
    if (status === 'maintenance') {
      this.maintenance = true;
      this.hub?.announce({
        severity: 'maintenance',
        displayMode: 'both',
        text: 'Шард переходит на обслуживание',
        scope: { kind: 'all' },
        pinned: true,
        expiresAtMs: null,
      });
      for (const p of this.partitions.values()) await p.sessions.maintenance();
      this.hub?.maintenance();
    } else if (status === 'draining') {
      this.state = 'DRAINING';
      void this.heartbeat();
    } else if (status === 'normal') {
      this.maintenance = false;
      if (this.state === 'DRAINING') this.state = 'READY';
      void this.heartbeat();
    }
  }

  // ── Остановка ────────────────────────────────────────────────

  private stopping: Promise<void> | null = null;

  /**
   * Плавная остановка: DRAINING, предупреждение, текущий тик завершается, финальный сброс, закрытие 4112,
   * очистка реестра. Жёсткий таймаут — `onHardTimeout`. Повторный вызов не запускает второй цикл.
   */
  shutdown(onHardTimeout: () => void = () => undefined): Promise<void> {
    if (this.stopping) return this.stopping;
    this.state = 'DRAINING';
    const hard = setTimeout(() => {
      this.ports.log('error', 'жёсткий таймаут остановки');
      onHardTimeout();
    }, this.config.hardTimeoutMs);
    hard.unref();
    this.stopping = (async () => {
      this.hub?.announce({
        severity: 'shutdown_countdown',
        displayMode: 'both',
        text: 'Сервер перезапускается',
        scope: { kind: 'all' },
        pinned: true,
        expiresAtMs: null,
      });
      await this.heartbeat();
      this.state = 'SHUTTING_DOWN';
      this.scheduler.stop();
      if (this.heartbeatTimer) this.scheduler.cancel(this.heartbeatTimer);
      for (const p of this.partitions.values()) await p.sessions.shutdown();
      await this.ports.finalFlush?.();
      for (const hook of this.stopHooks)
        await hook().catch((e) => this.ports.log('warn', 'хук остановки', { error: String(e) }));
      for (const p of this.partitions.values()) p.core.dispose();
      await this.ports.registry.clear([...this.partitions.keys()]).catch(() => undefined);
      clearTimeout(hard);
      this.state = 'STOPPED';
    })();
    return this.stopping;
  }
}
