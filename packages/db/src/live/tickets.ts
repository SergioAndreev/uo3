import { createHash } from 'node:crypto';
import type { Redis } from 'iovalkey';
import { KEYS, REVOKE_TTL_MS } from './keys.js';

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/** Выпуск пакета: снять прежний пакет аккаунта, проверить места, зарезервировать, сохранить билеты. */
const ISSUE = `
local prev = redis.call('GET', KEYS[5])
if prev then
  local p = cjson.decode(prev)
  redis.call('DEL', p.worldKey, p.hubKey)
  redis.call('ZREM', p.worldResv, p.bundleId)
  redis.call('ZREM', p.hubResv, p.bundleId)
end
local now = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', now)
if redis.call('ZCARD', KEYS[3]) >= tonumber(ARGV[6]) then return 'FULL_WORLD' end
if redis.call('ZCARD', KEYS[4]) >= tonumber(ARGV[7]) then return 'FULL_HUB' end
local ttl = tonumber(ARGV[3])
redis.call('ZADD', KEYS[3], now + ttl, ARGV[5])
redis.call('ZADD', KEYS[4], now + ttl, ARGV[5])
redis.call('PEXPIRE', KEYS[3], ttl + 60000)
redis.call('PEXPIRE', KEYS[4], ttl + 60000)
redis.call('SET', KEYS[1], ARGV[1], 'PX', ttl)
redis.call('SET', KEYS[2], ARGV[2], 'PX', ttl)
redis.call('SET', KEYS[5], ARGV[8], 'PX', ttl)
return 'OK'`;

/** Погашение: проверка комнаты, срока, эпох отзыва; удаление билета и резерва. */
const REDEEM = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'INVALID'} end
local t = cjson.decode(raw)
if t.shardId ~= ARGV[1] or t.roomType ~= ARGV[2] or t.roomId ~= ARGV[3] then
  redis.call('DEL', KEYS[1])
  return {'ROOM_MISMATCH'}
end
local now = tonumber(ARGV[4])
local resv = 'dm:shard:' .. t.shardId .. ':room:' .. t.roomId .. ':resv'
if t.expiresAt <= now then
  redis.call('DEL', KEYS[1])
  redis.call('ZREM', resv, t.bundleId)
  return {'EXPIRED'}
end
local epochs = {
  redis.call('GET', 'dm:revoke:account:' .. t.accountId),
  redis.call('GET', 'dm:revoke:char:' .. t.characterId)
}
local staff = { ['game-master'] = true, administrator = true, owner = true }
if not staff[t.accessLevel] then
  table.insert(epochs, redis.call('GET', 'dm:revoke:shard:' .. t.shardId))
end
for _, e in ipairs(epochs) do
  if e and tonumber(e) >= t.issuedAt then
    redis.call('DEL', KEYS[1])
    redis.call('ZREM', resv, t.bundleId)
    return {'REVOKED'}
  end
end
redis.call('DEL', KEYS[1])
redis.call('ZREM', resv, t.bundleId)
return {'OK', raw}`;

export interface BundleRooms {
  shardId: string;
  accountId: string;
  bundleId: string;
  world: { roomId: string; token: string; payload: object; free: number };
  hub: { roomId: string; token: string; payload: object; free: number };
  ttlMs: number;
  now: number;
}

export type IssueResult = 'OK' | 'FULL_WORLD' | 'FULL_HUB';

/** Сохраняет пару билетов атомарно; `free` — сколько ещё резервов допускает комната. */
export async function issueBundle(redis: Redis, b: BundleRooms): Promise<IssueResult> {
  const worldKey = KEYS.ticket(sha256Hex(b.world.token));
  const hubKey = KEYS.ticket(sha256Hex(b.hub.token));
  const worldResv = KEYS.reservations(b.shardId, b.world.roomId);
  const hubResv = KEYS.reservations(b.shardId, b.hub.roomId);
  const index = JSON.stringify({ bundleId: b.bundleId, worldKey, hubKey, worldResv, hubResv });
  return (await redis.eval(
    ISSUE,
    5,
    worldKey,
    hubKey,
    worldResv,
    hubResv,
    KEYS.accountBundle(b.shardId, b.accountId),
    JSON.stringify(b.world.payload),
    JSON.stringify(b.hub.payload),
    b.ttlMs,
    b.now,
    b.bundleId,
    Math.max(0, b.world.free),
    Math.max(0, b.hub.free),
    index,
  )) as IssueResult;
}

export type RedeemResult =
  | { ok: true; payload: unknown }
  | { ok: false; reason: 'INVALID' | 'ROOM_MISMATCH' | 'EXPIRED' | 'REVOKED' };

/** Погашение билета игровым сервером (P06) в `onAuth`. */
export async function redeemTicket(
  redis: Redis,
  token: string,
  room: { shardId: string; roomType: 'world' | 'hub'; roomId: string },
  now: number,
): Promise<RedeemResult> {
  const [status, raw] = (await redis.eval(
    REDEEM,
    1,
    KEYS.ticket(sha256Hex(token)),
    room.shardId,
    room.roomType,
    room.roomId,
    now,
  )) as [string, string?];
  if (status === 'OK') return { ok: true, payload: JSON.parse(raw ?? 'null') };
  return { ok: false, reason: status as Exclude<RedeemResult, { ok: true }>['reason'] };
}

/** Эпоха отзыва: билеты, выданные не позже `now`, больше не гасятся. */
export async function revokeTickets(
  redis: Redis,
  scope: 'account' | 'char' | 'shard',
  id: string,
  now: number,
): Promise<void> {
  await redis.set(KEYS.revoke(scope, id), String(now), 'PX', REVOKE_TTL_MS);
}

/** Число действующих резервов комнаты. */
export async function reservedSeats(
  redis: Redis,
  shard: string,
  room: string,
  now: number,
): Promise<number> {
  return redis.zcount(KEYS.reservations(shard, room), `(${now}`, '+inf');
}
