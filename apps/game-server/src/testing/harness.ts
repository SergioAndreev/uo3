import { createHash } from 'node:crypto';
import {
  RealmStore,
  SYNTHETIC_CATALOG,
  generateSyntheticPack,
  lineOfSight,
} from '@duskmarch/asset-formats';
import {
  IdAllocator,
  InMemoryIdLeaseProvider,
  SeededRng,
  makeEntityId,
  type AccessLevel,
} from '@duskmarch/domain';
import { EngineError } from '../engine/errors.js';
import type { HubClaims } from '../engine/hub.js';
import type { Entity } from '../engine/partition.js';
import { Scheduler } from '../engine/scheduler.js';
import type {
  ClientLink,
  HeroRecord,
  HeroSave,
  LogoutPolicy,
  SessionRecord,
  TicketClaims,
} from '../engine/session.js';
import { ShardNode, type LiveRegistry, type NodeConfig } from '../host/node.js';
import { safeZones, spawnResolver } from '../host/world-ports.js';

export interface TraceEvent {
  tick: number;
  type: string;
  data: Record<string, unknown>;
}

/** Виртуальный клиент: записывает сообщения и код закрытия. */
export class VirtualClient implements ClientLink {
  readonly messages: { type: string; payload: unknown }[] = [];
  closed: { code: number; reason: string } | null = null;
  constructor(readonly id: string) {}
  send(type: string, payload: unknown): void {
    this.messages.push({ type, payload });
  }
  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
  last(type: string): unknown {
    return this.messages.filter((m) => m.type === type).at(-1)?.payload;
  }
}

export interface HarnessOptions {
  seed?: number | string;
  partitions?: { partitionId: string; realm: 'proving' }[];
  logoutDelayMs?: number;
  strict?: boolean;
  config?: Partial<NodeConfig>;
}

/** Записанное действие стенда для воспроизведения (снапшоты как повтор журнала). */
type Action = (shard: HeadlessShard) => Promise<unknown> | unknown;

/**
 * Шард в памяти: синтетический план `proving` P02, ручной планировщик, сидируемый ГПСЧ,
 * билеты P05, хранилища и шина в памяти. Без сетевых портов и внешних БД.
 */
export class HeadlessShard {
  readonly scheduler: Scheduler;
  readonly rng: SeededRng;
  readonly node: ShardNode;
  readonly store: RealmStore;
  readonly heroes = new Map<string, HeroRecord & { saves: HeroSave[] }>();
  /** Деревья владения героев по `EntityId` (хранилище мира P08). */
  readonly heroTrees = new Map<number, Entity[]>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly registry: {
    heartbeats: unknown[];
    partitions: Map<string, unknown>;
    hub: unknown;
    cleared: boolean;
  };
  readonly bus: { subject: string; payload: Record<string, unknown> }[] = [];
  readonly trace: TraceEvent[] = [];
  readonly audit: string[] = [];
  readonly policies: LogoutPolicy[] = [];
  private readonly worldTickets = new Map<string, { partitionId: string; claims: TicketClaims }>();
  private readonly hubTickets = new Map<string, HubClaims>();
  private readonly extraSafe = new Set<string>();
  private readonly actions: Action[] = [];
  private clients = 0;
  private heroSeq = 0;
  private readonly strict: boolean;
  private readonly landmarks: Record<string, { x: number; y: number }[]>;
  overBudget = 0;

  private constructor(
    readonly options: HarnessOptions,
    pack: ReturnType<typeof generateSyntheticPack>,
  ) {
    this.strict = options.strict ?? true;
    this.rng = new SeededRng(options.seed ?? 'duskmarch');
    this.scheduler = new Scheduler({
      perfNow: () => 0,
      onError: (e) => this.record('error', { message: String(e) }),
    });
    this.store = RealmStore.fromPack(pack.manifest, (p) => pack.files.get(p), SYNTHETIC_CATALOG);
    this.landmarks = (pack.world.landmarks ?? {}) as Record<string, { x: number; y: number }[]>;
    const zones = safeZones(this.landmarks);
    const resolve = spawnResolver(this.store, 7);
    const state = {
      heartbeats: [] as unknown[],
      partitions: new Map<string, unknown>(),
      hub: null as unknown,
      cleared: false,
    };
    const registry: LiveRegistry = {
      heartbeat: async (hb) => void state.heartbeats.push(hb),
      partition: async (p) => void state.partitions.set(p.partitionId, p),
      hub: async (h) => void (state.hub = h),
      clear: async () => void (state.cleared = true),
    };
    this.registry = state;
    this.node = new ShardNode(
      {
        shardId: 'local-dev',
        nodeId: 'headless',
        role: 'all',
        wsUrl: 'ws://headless',
        heartbeatMs: 5_000,
        logoutDelayMs: options.logoutDelayMs ?? 120_000,
        reconnectWindowMs: 30_000,
        idleTimeoutMs: 30 * 60_000,
        capacity: 500,
        staffBuffer: 20,
        motd: 'Испытательный рубеж',
        hardTimeoutMs: 30_000,
        ...options.config,
      },
      {
        registry,
        sessionPorts: (partitionId) => ({
          redeem: async (token) => {
            const t = this.worldTickets.get(token);
            this.worldTickets.delete(token);
            return t && t.partitionId === partitionId
              ? { ok: true, claims: t.claims }
              : { ok: false };
          },
          loadHero: async (id) => this.heroes.get(id) ?? null,
          loadHeroTree: async (entityId) =>
            (this.heroTrees.get(entityId) ?? []).map((e) => ({ ...e })),
          saveHero: async (id, save) => {
            const hero = this.heroes.get(id);
            if (hero)
              Object.assign(hero, {
                x: save.x,
                y: save.y,
                h: save.h,
                vitals: save.vitals,
              }).saves.push(save);
          },
          claim: async (account, record) => {
            const cur = this.sessions.get(account);
            if (cur && cur.characterId !== record.characterId) return cur;
            this.sessions.set(account, record);
            return 'claimed';
          },
          updateSession: async (account, record) => void this.sessions.set(account, record),
          release: async (account, sessionId) => {
            if (this.sessions.get(account)?.sessionId === sessionId) this.sessions.delete(account);
          },
          resolveSpawn: (_realm, x, y, h) => resolve(x, y, h),
          isSafeZone: (_realm, x, y) => zones(x, y) || this.extraSafe.has(`${x},${y}`),
          newToken: () => this.rng.next().toString(36) + this.rng.next().toString(36),
          warn: (msg, data) => this.record('warn', { msg, ...data }),
        }),
        hubPorts: {
          redeem: async (token) => {
            const c = this.hubTickets.get(token);
            this.hubTickets.delete(token);
            return c ? { ok: true, claims: c } : { ok: false };
          },
          audit: (action) => void this.audit.push(action),
          newId: () => `ann-${this.rng.next().toString(36)}`,
        },
        publish: (subject, payload) => {
          this.bus.push({ subject, payload });
          this.record(subject, payload);
        },
        wallNow: () => this.scheduler.timeMs,
        log: (level, msg, data) => this.record(`log.${level}`, { msg, ...data }),
      },
      this.scheduler,
    );
  }

  static async create(options: HarnessOptions = {}): Promise<HeadlessShard> {
    const pack = generateSyntheticPack('proving', 42);
    const shard = new HeadlessShard(options, pack);
    const allocator = new IdAllocator(new InMemoryIdLeaseProvider(), { leaseSize: 256 });
    await allocator.ready();
    for (const p of options.partitions ?? [{ partitionId: 'proving-0', realm: 'proving' }]) {
      shard.node.addPartition({
        partitionId: p.partitionId,
        realm: { key: 'proving', width: 64, height: 64 },
        bounds: { minX: 0, minY: 0, maxX: 63, maxY: 63 },
        allocator,
      });
    }
    for (const p of shard.node.partitions.values()) {
      p.sessions.addLogoutPolicy((id) => shard.policies.some((policy) => policy(id)));
    }
    shard.node.ready();
    return shard;
  }

  private record(type: string, data: Record<string, unknown>): void {
    this.trace.push({
      tick: this.scheduler.tick,
      type,
      data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>,
    });
  }

  /** Строгий режим: системные часы и `Math.random` запрещены во время тика. */
  private guarded<T>(body: () => T): T {
    if (!this.strict) return body();
    const date = Date.now;
    const random = Math.random;
    const forbid = () => {
      throw new EngineError(
        'HARNESS_DETERMINISM_VIOLATION',
        'обращение к системным часам или Math.random в тике',
      );
    };
    Date.now = forbid;
    Math.random = forbid;
    try {
      return body();
    } finally {
      Date.now = date;
      Math.random = random;
    }
  }

  /** Обработчики тика ловят ошибки планировщика; нарушение детерминизма пробрасывается как провал шага. */
  step(n = 1): void {
    if (!Number.isInteger(n) || n < 0) throw new EngineError('ERR_INVALID_TIME_DELTA', `шаг ${n}`);
    this.actions.push((s) => s.step(n));
    for (let i = 0; i < n; i++) {
      const before = this.trace.length;
      this.guarded(() => this.scheduler.step());
      const violation = this.trace
        .slice(before)
        .find(
          (e) =>
            e.type === 'error' &&
            String(e.data['message']).includes('HARNESS_DETERMINISM_VIOLATION'),
        );
      if (violation)
        throw new EngineError('HARNESS_DETERMINISM_VIOLATION', String(violation.data['message']));
    }
  }

  advanceMs(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0)
      throw new EngineError('ERR_INVALID_TIME_DELTA', `шаг ${ms} мс`);
    this.step(Math.round(ms / this.scheduler.tickMs));
  }

  async advanceUntil(predicate: () => boolean, maxTicks: number): Promise<number> {
    for (let i = 0; i <= maxTicks; i++) {
      await flush();
      if (predicate()) return i;
      if (i < maxTicks) this.step();
    }
    throw new EngineError('HARNESS_WAIT_TIMEOUT', `условие не выполнено за ${maxTicks} тиков`);
  }

  // ── Фабрики ──────────────────────────────────────────────────

  /** Герой в хранилище (как созданный API P05). */
  hero(
    opts: {
      characterId?: string;
      x?: number;
      y?: number;
      h?: number;
      status?: HeroRecord['status'];
    } = {},
  ) {
    const characterId = opts.characterId ?? `hero-${++this.heroSeq}`;
    const record = {
      status: opts.status ?? 'active',
      realm: 'proving',
      x: opts.x ?? 32,
      y: opts.y ?? 32,
      h: opts.h ?? 0,
      vitals: { health: 84, verve: 64, resonance: 56 },
      saves: [] as HeroSave[],
    } as HeroRecord & { saves: HeroSave[] };
    this.heroes.set(characterId, record);
    return { characterId, entityId: makeEntityId('hero', this.heroSeq + 1000) };
  }

  /** Билеты как у P05: `world` для партиции и `hub`. */
  tickets(
    accountId: string,
    characterId: string,
    level: AccessLevel = 'player',
    partitionId = 'proving-0',
  ) {
    const hero = this.heroes.get(characterId);
    const entityId = Number(
      makeEntityId(
        'hero',
        Number(createHash('sha256').update(characterId).digest().readUInt32BE(0) % 1_000_000) + 1,
      ),
    );
    const claims: TicketClaims = {
      accountId,
      characterId,
      entityId,
      name: characterId,
      accessLevel: level,
      effectiveLevel: level,
      realm: 'proving',
      x: hero?.x ?? 32,
      y: hero?.y ?? 32,
      h: hero?.h ?? 0,
      takeover: false,
    };
    const world = `w-${this.rng.next().toString(36)}${this.rng.next().toString(36)}`;
    const hub = `h-${this.rng.next().toString(36)}${this.rng.next().toString(36)}`;
    this.worldTickets.set(world, { partitionId, claims });
    this.hubTickets.set(hub, {
      accountId,
      characterId,
      entityId,
      accessLevel: level,
      effectiveLevel: level,
    });
    return { world, hub };
  }

  /** Виртуальный игрок: билеты, подключение к партиции и хабу. */
  async player(
    accountId: string,
    opts: { level?: AccessLevel; x?: number; y?: number; characterId?: string; hub?: boolean } = {},
  ) {
    this.actions.push((s) => s.player(accountId, opts));
    const { characterId } = this.heroes.has(opts.characterId ?? '')
      ? { characterId: opts.characterId as string }
      : this.hero({
          characterId: opts.characterId ?? `${accountId}-hero`,
          ...(opts.x !== undefined ? { x: opts.x } : {}),
          ...(opts.y !== undefined ? { y: opts.y } : {}),
        });
    const t = this.tickets(accountId, characterId, opts.level ?? 'player');
    const world = new VirtualClient(`vc${this.clients++}`);
    const session = await this.node.joinWorld('proving-0', world, { ticket: t.world });
    let hub: VirtualClient | null = null;
    if (opts.hub !== false && this.node.hub) {
      hub = new VirtualClient(`vh${this.clients++}`);
      await this.node.joinHub(hub, t.hub);
    }
    return { session, world, hub, characterId };
  }

  /** Безопасная зона — прямоугольник клеток. */
  safeZone(minX: number, minY: number, maxX: number, maxY: number): void {
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) this.extraSafe.add(`${x},${y}`);
  }

  get partition() {
    return this.node.partitions.get('proving-0') as NonNullable<
      ReturnType<ShardNode['partitions']['get']>
    >;
  }

  /** Инъекция события P04/P05. */
  async inject(subject: string, event: Record<string, unknown>): Promise<boolean> {
    this.actions.push((s) => s.inject(subject, event));
    return this.node.handleEvent(subject, event);
  }

  sight(from: { x: number; y: number; h: number }, to: { x: number; y: number; h: number }) {
    return lineOfSight(this.store, from, to, { dynamic: this.partition.core.obstaclesAt });
  }

  // ── Воспроизводимость ────────────────────────────────────────

  /** SHA-256 состояния: тик, ГПСЧ, сущности, таймеры, сессии, присутствие. */
  fingerprint(): string {
    const entities = this.partition.core.all().map((e) => [e.id, e.kind, e.placement]);
    const state = {
      tick: this.scheduler.tick,
      rng: this.rng.snapshot(),
      entities,
      timers: this.scheduler.wheel.size,
      sessions: [...this.sessions.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, v.characterId, v.state]),
      online: this.node.hub?.visibleCount('owner') ?? 0,
    };
    return createHash('sha256').update(JSON.stringify(state)).digest('hex');
  }

  /** Снапшот — журнал действий; откат — новый шард с тем же сидом и повтором журнала (детерминизм). */
  snapshot(): Action[] {
    return [...this.actions];
  }

  static async restore(
    options: HarnessOptions,
    snapshot: readonly Action[],
  ): Promise<HeadlessShard> {
    const shard = await HeadlessShard.create(options);
    for (const action of snapshot) await action(shard);
    shard.actions.length = 0;
    shard.actions.push(...snapshot);
    return shard;
  }

  /** Отчёт при завершении теста. */
  dispose() {
    return {
      activeTimers: this.scheduler.wheel.size,
      overBudget: this.overBudget,
      errors: this.scheduler.errors,
    };
  }
}

/** Первое расхождение двух трасс: номер тика, тип события и различающиеся поля. */
export function diffTraces(a: readonly TraceEvent[], b: readonly TraceEvent[]) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    const fields =
      x && y
        ? [...new Set([...Object.keys(x.data), ...Object.keys(y.data)])].filter(
            (k) => JSON.stringify(x.data[k]) !== JSON.stringify(y.data[k]),
          )
        : [];
    return {
      index: i,
      tick: (x ?? y)?.tick ?? -1,
      type: (x ?? y)?.type ?? '',
      fields,
      left: x ?? null,
      right: y ?? null,
    };
  }
  return null;
}

export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
