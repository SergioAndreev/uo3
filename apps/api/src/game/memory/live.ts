import { createHash } from 'node:crypto';
import type {
  BundleInput,
  HubInfo,
  LivePort,
  LiveSession,
  PartitionInfo,
  ShardLive,
} from '../ports.js';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const STAFF = new Set(['game-master', 'administrator', 'owner']);

interface Stored {
  payload: Record<string, unknown> & {
    shardId: string;
    roomType: string;
    roomId: string;
    bundleId: string;
  };
  expiresAt: number;
}

/** Живое состояние и билеты в памяти с семантикой Lua-скриптов `@duskmarch/db/live`. */
export class MemoryLive implements LivePort {
  readonly nodes = new Map<string, ShardLive['nodes']>();
  readonly partitions = new Map<string, PartitionInfo[]>();
  readonly hubs = new Map<string, HubInfo>();
  readonly sessions = new Map<string, LiveSession>();
  readonly tickets = new Map<string, Stored>();
  private readonly resv = new Map<string, Map<string, number>>();
  private readonly bundles = new Map<
    string,
    { bundleId: string; keys: string[]; rooms: string[] }
  >();
  private readonly epochs = new Map<string, number>();
  failing = false;

  /** Узел, партиция на весь план и хаб — как опубликовал бы игровой сервер. */
  online(
    shardId: string,
    now: number,
    opts: Partial<PartitionInfo> & { tickP99Ms?: number } = {},
  ): void {
    this.nodes.set(shardId, [
      {
        nodeId: 'node-1',
        onlineCount: opts.onlineCount ?? 0,
        tickP99Ms: opts.tickP99Ms ?? 10,
        draining: false,
        updatedAt: now,
      },
    ]);
    this.partitions.set(shardId, [
      {
        partitionId: 'p-1',
        realm: opts.realm ?? 'dawn',
        minX: 0,
        minY: 0,
        maxX: opts.maxX ?? 4095,
        maxY: opts.maxY ?? 4095,
        roomId: opts.roomId ?? `${shardId}-world`,
        wsUrl: 'ws://127.0.0.1:2567',
        hardCapacity: opts.hardCapacity ?? 100,
        staffBuffer: opts.staffBuffer ?? 5,
        onlineCount: opts.onlineCount ?? 0,
        draining: opts.draining ?? false,
        updatedAt: now,
      },
    ]);
    this.hubs.set(shardId, {
      roomId: `${shardId}-hub`,
      wsUrl: 'ws://127.0.0.1:2567',
      hardCapacity: opts.hardCapacity ?? 100,
      staffBuffer: opts.staffBuffer ?? 5,
      onlineCount: 0,
      draining: false,
      updatedAt: now,
    });
  }

  async read(shardId: string): Promise<ShardLive> {
    if (this.failing) throw new Error('Valkey недоступен');
    return {
      nodes: structuredClone(this.nodes.get(shardId) ?? []),
      partitions: structuredClone(this.partitions.get(shardId) ?? []),
      hub: structuredClone(this.hubs.get(shardId) ?? null),
    };
  }

  async session(shardId: string, accountId: string): Promise<LiveSession | null> {
    return this.sessions.get(`${shardId}:${accountId}`) ?? null;
  }

  private rooms(shardId: string, roomId: string) {
    const key = `${shardId}:${roomId}`;
    let map = this.resv.get(key);
    if (!map) this.resv.set(key, (map = new Map()));
    return map;
  }

  async issue(b: BundleInput): Promise<'OK' | 'FULL_WORLD' | 'FULL_HUB'> {
    const indexKey = `${b.shardId}:${b.accountId}`;
    const prev = this.bundles.get(indexKey);
    if (prev) {
      for (const k of prev.keys) this.tickets.delete(k);
      for (const r of prev.rooms) this.rooms(b.shardId, r).delete(prev.bundleId);
    }
    const world = this.rooms(b.shardId, b.world.roomId);
    const hub = this.rooms(b.shardId, b.hub.roomId);
    for (const map of [world, hub]) for (const [m, exp] of map) if (exp <= b.now) map.delete(m);
    if (world.size >= b.world.free) return 'FULL_WORLD';
    if (hub.size >= b.hub.free) return 'FULL_HUB';
    world.set(b.bundleId, b.now + b.ttlMs);
    hub.set(b.bundleId, b.now + b.ttlMs);
    const keys = [sha(b.world.token), sha(b.hub.token)];
    this.tickets.set(keys[0] as string, {
      payload: b.world.payload as Stored['payload'],
      expiresAt: b.now + b.ttlMs,
    });
    this.tickets.set(keys[1] as string, {
      payload: b.hub.payload as Stored['payload'],
      expiresAt: b.now + b.ttlMs,
    });
    this.bundles.set(indexKey, {
      bundleId: b.bundleId,
      keys,
      rooms: [b.world.roomId, b.hub.roomId],
    });
    return 'OK';
  }

  /** Погашение — как `redeemTicket` для игрового сервера. */
  redeem(token: string, room: { shardId: string; roomType: string; roomId: string }, now: number) {
    const key = sha(token);
    const stored = this.tickets.get(key);
    if (!stored || stored.expiresAt <= now) return { ok: false as const, reason: 'INVALID' };
    this.tickets.delete(key);
    const p = stored.payload;
    if (p.shardId !== room.shardId || p.roomType !== room.roomType || p.roomId !== room.roomId) {
      return { ok: false as const, reason: 'ROOM_MISMATCH' };
    }
    const issued = Number(p['issuedAt']);
    const epochs = [
      this.epochs.get(`account:${String(p['accountId'])}`),
      this.epochs.get(`char:${String(p['characterId'])}`),
    ];
    if (!STAFF.has(String(p['accessLevel']))) epochs.push(this.epochs.get(`shard:${p.shardId}`));
    if (epochs.some((e) => e !== undefined && e >= issued))
      return { ok: false as const, reason: 'REVOKED' };
    this.rooms(p.shardId, p.roomId).delete(p.bundleId);
    return { ok: true as const, payload: p };
  }

  async revoke(scope: 'account' | 'char' | 'shard', id: string, now: number): Promise<void> {
    this.epochs.set(`${scope}:${id}`, now);
  }

  async reserved(shardId: string, roomId: string, now: number): Promise<number> {
    return [...this.rooms(shardId, roomId).values()].filter((exp) => exp > now).length;
  }
}
