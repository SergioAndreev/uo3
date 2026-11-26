import type { StateView } from '@colyseus/schema';
import type { EntityId } from '@duskmarch/domain';
import { NETCODE_CLOSE } from '@duskmarch/protocol';
import { PartitionState } from '@duskmarch/protocol/state';
import type { PartitionEvent } from '../engine/partition.js';
import type { Scheduler } from '../engine/scheduler.js';
import type { Session } from '../engine/session.js';
import type { PartitionRuntime } from '../host/node.js';
import { EventChannel } from './events.js';
import type { HandshakeConfig } from './handshake.js';
import { InterestManager, concealment, fogPredicate, type Observer } from './interest.js';
import {
  ProjectionSync,
  type BeingView,
  type PrivateView,
  type RelationProvider,
} from './projection.js';
import { ReplicationScheduler } from './replication.js';
import { IntentRouter, NetSession } from './router.js';

/** Общие параметры сетевого слоя шарда. */
export interface NetContext {
  shardId: string;
  handshake: Omit<HandshakeConfig, 'clock' | 'tickIntervalMs'>;
  radius: number;
  largeRadius: number;
  hysteresis?: number;
  fogRange?: (realm: string, x: number, y: number) => number | null;
  relations?: RelationProvider;
  /** Внешность и ресурсы героя; до P09/P15 — значения по умолчанию. */
  heroView?: (session: Session) => Partial<BeingView>;
  heroPrivate?: (session: Session) => Partial<PrivateView>;
  /** Монотонные часы сервера, мс. */
  now: () => number;
  log?: (level: 'warn' | 'error', msg: string, data: Record<string, unknown>) => void;
}

/** Транспорт одного клиента. */
export interface NetPort {
  readonly id: string;
  readonly view: StateView;
  send(opcode: number, payload: unknown): void;
  close(code: number): void;
  /** Байты в исходящем буфере сокета. */
  buffered(): number;
}

interface NetClient {
  port: NetPort;
  net: NetSession;
  hero: EntityId;
}

const DEFAULT_PRIVATE: PrivateView = {
  might: 0,
  finesse: 0,
  will: 0,
  health: 0,
  maxHealth: 0,
  verve: 0,
  maxVerve: 0,
  resonance: 0,
  maxResonance: 0,
  weightKg: 0,
  maxWeightKg: 0,
  money: 0,
  defense: 0,
  personalLight: 0,
  offenderRemainingMs: 0,
  outcastKills: 0,
};

/** Сетевой слой одной партиции: рукопожатие, намерения, область интереса, проекция, события, бюджет. */
export class PartitionNet {
  readonly state = new PartitionState();
  readonly aoi: InterestManager;
  readonly projection: ProjectionSync;
  readonly replication: ReplicationScheduler;
  readonly events: EventChannel;
  readonly router: IntentRouter;
  private readonly clients = new Map<string, NetClient>();
  private readonly byHero = new Map<EntityId, NetClient>();

  constructor(
    private readonly runtime: PartitionRuntime,
    private readonly scheduler: Scheduler,
    private readonly ctx: NetContext,
  ) {
    Object.assign(this.state, {
      shardId: ctx.shardId,
      partitionId: runtime.partitionId,
      realm: runtime.realm,
      protocolVersion: ctx.handshake.protocolVersion,
      worldVersion: ctx.handshake.worldVersion,
      rulesetFingerprint: ctx.handshake.rulesetFingerprint,
    });
    this.aoi = new InterestManager({
      radius: ctx.radius,
      largeRadius: ctx.largeRadius,
      ...(ctx.hysteresis !== undefined ? { hysteresis: ctx.hysteresis } : {}),
      predicates: ctx.fogRange ? [concealment, fogPredicate(ctx.fogRange)] : [concealment],
    });
    this.projection = new ProjectionSync(
      this.state,
      {
        being: (id) => this.beingView(id),
        item: (id) => {
          const e = this.runtime.core.get(id);
          if (e?.placement.kind !== 'world') return undefined;
          const { x, y, h } = e.placement;
          return {
            contentKey: `item.${id}`,
            tint: 0,
            amount: 1,
            x,
            y,
            h,
            directionOrLight: 0,
            flags: 0,
            structureId: 0,
            structureRevision: 0,
          };
        },
        structure: (id) => {
          const r = this.runtime.core.get(id)?.rect;
          return r ? { contentKey: 'structure', ...r, h: 0, revision: 0, flags: 0 } : undefined;
        },
        containerItem: () => undefined,
        privateOf: (id) => {
          const s = this.runtime.sessions.ofEntity(id);
          if (!s) return undefined;
          return { ...DEFAULT_PRIVATE, ...s.vitals, ...this.ctx.heroPrivate?.(s) };
        },
      },
      ctx.relations,
    );
    this.replication = new ReplicationScheduler(this.aoi);
    this.events = new EventChannel(this.aoi, {
      send: (hero, opcode, payload) => this.byHero.get(hero)?.port.send(opcode, payload),
      buffered: (hero) => this.byHero.get(hero)?.port.buffered() ?? 0,
      close: (hero, code) => this.byHero.get(hero)?.net.close(code),
    });
    this.router = new IntentRouter({
      room: 'world',
      handshake: {
        ...ctx.handshake,
        tickIntervalMs: scheduler.tickMs,
        clock: () => ({ tick: scheduler.tick, timeMs: ctx.now() }),
      },
      enqueue: (item) => scheduler.enqueue(item),
      tick: () => scheduler.tick,
      now: ctx.now,
      tickStats: () => ({
        tick: scheduler.tick,
        tickStartMs: scheduler.lastTickStartedMs,
        tickIntervalMs: scheduler.tickMs,
        loadPct: (scheduler.tickP99Ms * 100) / scheduler.tickMs,
        overrun: scheduler.status === 'degraded',
      }),
      ...(ctx.log ? { log: ctx.log } : {}),
    });
    for (const e of runtime.core.all()) this.track(e.id);
    runtime.listeners.add({
      event: (event) => this.onEvent(event),
      dirty: (id) => this.projection.markDirty(id),
    });
  }

  private beingView(id: EntityId): BeingView | undefined {
    const e = this.runtime.core.get(id);
    if (e?.placement.kind !== 'world') return undefined;
    const { x, y, h } = e.placement;
    const s = e.player ? this.runtime.sessions.ofEntity(id) : undefined;
    return {
      kind: e.kind === 'hero' ? 'hero' : 'creature',
      name: s?.name ?? '',
      model: e.kind === 'hero' ? 'hero.frame-humanoid' : `creature.${id}`,
      tint: 0,
      x,
      y,
      h,
      direction: 0,
      baseReputation: 'neutral',
      statusFlags: 0,
      healthPercent: 100,
      mountModel: '',
      mountTint: 0,
      equipment: {},
      ...(s ? this.ctx.heroView?.(s) : {}),
    };
  }

  /** Сущность ядра → кандидат области интереса. */
  private track(id: EntityId): void {
    const e = this.runtime.core.get(id);
    if (!e || e.placement.kind !== 'world') {
      this.aoi.remove(id);
      return;
    }
    const kind = e.kind === 'item' ? 'item' : e.kind === 'structure' ? 'structure' : 'being';
    const { x, y } = e.placement;
    this.aoi.upsert({
      id,
      kind,
      realm: this.runtime.realm,
      x,
      y,
      ...(e.rect ? { rect: e.rect } : {}),
    });
    this.projection.markDirty(id);
  }

  private onEvent(event: PartitionEvent): void {
    if (event.type === 'sector') return;
    if (event.type === 'entity.moved') {
      this.aoi.move(event.id, event.x, event.y);
      this.projection.markDirty(event.id);
      return;
    }
    if (event.type === 'entity.spawned') this.track(event.id);
    else {
      this.aoi.remove(event.id);
      this.replication.forget(event.id);
    }
  }

  /** Клиент вошёл (после `onJoin` P06): рукопожатие ещё впереди. */
  join(port: NetPort, session: Session): NetSession {
    const net = new NetSession(
      session.entityId,
      {
        send: (opcode, payload) => port.send(opcode, payload),
        close: (code) => port.close(code),
        accessLevel: () => session.effectiveLevel,
        heroState: () => 'alive',
        audit: (event, data) =>
          this.ctx.log?.('warn', `аудит: ${event}`, { entityId: session.entityId, ...data }),
      },
      this.ctx.now(),
    );
    const client = { port, net, hero: session.entityId };
    this.clients.set(port.id, client);
    this.byHero.set(session.entityId, client);
    this.track(session.entityId);
    const e = this.runtime.core.get(session.entityId);
    const at = e?.placement.kind === 'world' ? e.placement : { x: 0, y: 0 };
    const observer: Observer = {
      id: session.entityId,
      realm: this.runtime.realm,
      x: at.x,
      y: at.y,
      level: session.effectiveLevel,
      detects: new Set(),
      targets: new Set(),
      group: new Set(),
    };
    this.aoi.addObserver(observer);
    this.projection.addClient(session.entityId, port.view);
    this.replication.addClient(session.entityId, this.ctx.now());
    return net;
  }

  leave(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    client.net.state = 'closed';
    this.clients.delete(clientId);
    this.byHero.delete(client.hero);
    this.aoi.removeObserver(client.hero);
    this.projection.removeClient(client.hero);
    this.replication.removeClient(client.hero);
  }

  receive(clientId: string, opcode: number, payload: unknown, frameBytes: number): void {
    const client = this.clients.get(clientId);
    if (client) this.router.receive(client.net, opcode, payload, frameBytes);
  }

  /** Служебные сообщения P06 (heartbeat, выход) тоже продлевают жизнь соединения. */
  inbound(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) client.net.lastInboundMs = this.ctx.now();
  }

  sessionOf(clientId: string): NetSession | undefined {
    return this.clients.get(clientId)?.net;
  }

  recordBytes(clientId: string, bytes: number): void {
    const client = this.clients.get(clientId);
    if (client) this.replication.record(client.hero, bytes, this.ctx.now());
  }

  /** Конец тика: таймауты, область интереса, проекция по приоритетам, события. Затем — патч. */
  postTick(tick: number): void {
    const now = this.ctx.now();
    for (const client of this.clients.values()) this.router.checkTimeouts(client.net);
    for (const [hero, diff] of this.aoi.flush()) {
      this.projection.apply(hero, diff);
      if (diff.reset) this.replication.allowBurst(hero, now);
    }
    for (const hero of this.byHero.keys())
      this.projection.syncContents(hero, this.aoi.containerContents(hero));
    for (const id of this.projection.pending) this.replication.touched(id, tick);
    this.projection.flush((id) => this.replication.due(id, tick));
    this.state.serverTick = tick;
    this.state.onlineCount = this.runtime.sessions.count;
    this.events.endTick(this.byHero.keys(), now);
  }

  /** Код закрытия при остановке сетевого слоя. */
  static readonly CLOSE = NETCODE_CLOSE;
}
