import type { Redis } from 'iovalkey';
import { HEARTBEAT_TTL_MS, KEYS, REGISTRY_TTL_MS } from './keys.js';

export interface NodeHeartbeat {
  nodeId: string;
  onlineCount: number;
  tickP99Ms: number;
  draining: boolean;
  updatedAt: number;
}

export interface PartitionInfo {
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
}

export interface HubInfo {
  roomId: string;
  wsUrl: string;
  hardCapacity: number;
  staffBuffer: number;
  onlineCount: number;
  draining: boolean;
  updatedAt: number;
}

/** Живая сессия аккаунта на шарде; поля P06 необязательны для читателей P05. */
export interface LiveSession {
  characterId: string;
  state: 'online' | 'logout_delay';
  entityId?: number;
  worldRoomId?: string;
  nodeId?: string;
  sessionId?: string;
  updatedAt?: number;
}

const CLAIM = `
local cur = redis.call('GET', KEYS[1])
if cur then
  local c = cjson.decode(cur)
  if c.characterId ~= ARGV[2] then return cur end
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
return 'claimed'`;

const RELEASE = `
local cur = redis.call('GET', KEYS[1])
if cur and cjson.decode(cur).sessionId == ARGV[1] then redis.call('DEL', KEYS[1]) return 1 end
return 0`;

/** Атомарный захват: `claimed` или запись другого героя аккаунта. */
export async function claimSession(
  redis: Redis,
  shard: string,
  account: string,
  session: LiveSession,
  ttlMs: number,
): Promise<'claimed' | LiveSession> {
  const result = (await redis.eval(
    CLAIM,
    1,
    KEYS.session(shard, account),
    JSON.stringify(session),
    session.characterId,
    ttlMs,
  )) as string;
  return result === 'claimed' ? 'claimed' : (JSON.parse(result) as LiveSession);
}

/** Удаляет запись, только если она принадлежит этой сессии. */
export async function releaseSession(
  redis: Redis,
  shard: string,
  account: string,
  sessionId: string,
) {
  return Number(await redis.eval(RELEASE, 1, KEYS.session(shard, account), sessionId)) === 1;
}

export interface ShardLive {
  nodes: NodeHeartbeat[];
  partitions: PartitionInfo[];
  hub: HubInfo | null;
}

/** Запись heartbeat узла (пишет игровой сервер P06). */
export async function publishHeartbeat(
  redis: Redis,
  shard: string,
  hb: NodeHeartbeat,
): Promise<void> {
  await redis
    .multi()
    .set(KEYS.heartbeat(shard, hb.nodeId), JSON.stringify(hb), 'PX', HEARTBEAT_TTL_MS)
    .sadd(KEYS.nodes(shard), hb.nodeId)
    .pexpire(KEYS.nodes(shard), REGISTRY_TTL_MS * 3)
    .exec();
}

export async function publishPartition(
  redis: Redis,
  shard: string,
  p: PartitionInfo,
): Promise<void> {
  await redis
    .multi()
    .hset(KEYS.partitions(shard), p.partitionId, JSON.stringify(p))
    .pexpire(KEYS.partitions(shard), REGISTRY_TTL_MS)
    .exec();
}

export async function publishHub(redis: Redis, shard: string, hub: HubInfo): Promise<void> {
  await redis.set(KEYS.hub(shard), JSON.stringify(hub), 'PX', REGISTRY_TTL_MS);
}

export async function publishSession(
  redis: Redis,
  shard: string,
  account: string,
  session: LiveSession | null,
  ttlMs = REGISTRY_TTL_MS,
): Promise<void> {
  if (session === null) await redis.del(KEYS.session(shard, account));
  else await redis.set(KEYS.session(shard, account), JSON.stringify(session), 'PX', ttlMs);
}

const parse = <T>(raw: string | null | undefined): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

/** Живое состояние шарда; записи старше срока жизни отбрасываются. */
export async function readShardLive(redis: Redis, shard: string, now: number): Promise<ShardLive> {
  const nodeIds = await redis.smembers(KEYS.nodes(shard));
  const [beats, partitions, hub] = await Promise.all([
    nodeIds.length
      ? redis.mget(...nodeIds.map((n) => KEYS.heartbeat(shard, n)))
      : Promise.resolve([]),
    redis.hgetall(KEYS.partitions(shard)),
    redis.get(KEYS.hub(shard)),
  ]);
  const nodes = beats
    .map((raw) => parse<NodeHeartbeat>(raw))
    .filter((n): n is NodeHeartbeat => n !== null && now - n.updatedAt < HEARTBEAT_TTL_MS);
  const parts = Object.values(partitions)
    .map((raw) => parse<PartitionInfo>(raw))
    .filter((p): p is PartitionInfo => p !== null && now - p.updatedAt < REGISTRY_TTL_MS);
  const hubInfo = parse<HubInfo>(hub);
  return {
    nodes,
    partitions: parts,
    hub: hubInfo && now - hubInfo.updatedAt < REGISTRY_TTL_MS ? hubInfo : null,
  };
}

export async function readSession(
  redis: Redis,
  shard: string,
  account: string,
): Promise<LiveSession | null> {
  return parse<LiveSession>(await redis.get(KEYS.session(shard, account)));
}
