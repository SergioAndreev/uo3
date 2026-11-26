import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ValkeyEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { Redis } from 'iovalkey';
import { afterAll, describe, expect, it } from 'vitest';
import {
  HEARTBEAT_TTL_MS,
  KEYS,
  issueBundle,
  publishHeartbeat,
  publishHub,
  publishPartition,
  publishSession,
  readSession,
  readShardLive,
  redeemTicket,
  reservedSeats,
  revokeTickets,
} from './index.js';

const config = loadServerConfig(ValkeyEnvSchema, {
  cwd: fileURLToPath(new URL('../../../../apps/api', import.meta.url)),
});
const redis = new Redis(config.VALKEY_URL, {
  ...(config.VALKEY_PASSWORD ? { password: config.VALKEY_PASSWORD } : {}),
});
afterAll(() => redis.disconnect());

const shard = () => `t-${randomUUID().slice(0, 8)}`;
const T = 1_800_000_000_000;

const payload = (s: string, roomType: 'world' | 'hub', over: Record<string, unknown> = {}) => ({
  bundleId: 'b1',
  shardId: s,
  roomType,
  roomId: roomType === 'world' ? 'w1' : 'h1',
  accountId: 'acc',
  characterId: 'chr',
  accessLevel: 'player',
  issuedAt: T,
  expiresAt: T + 30_000,
  ...over,
});

const bundle = (s: string, over: Partial<Parameters<typeof issueBundle>[1]> = {}) => ({
  shardId: s,
  accountId: 'acc',
  bundleId: 'b1',
  world: { roomId: 'w1', token: `w-${randomUUID()}`, payload: payload(s, 'world'), free: 10 },
  hub: { roomId: 'h1', token: `h-${randomUUID()}`, payload: payload(s, 'hub'), free: 10 },
  ttlMs: 30_000,
  now: T,
  ...over,
});

describe('heartbeat и реестр', () => {
  it('живые узлы, партиции, хаб, сессия; устаревшие отброшены', async () => {
    const s = shard();
    await publishHeartbeat(redis, s, {
      nodeId: 'n1',
      onlineCount: 120,
      tickP99Ms: 20,
      draining: false,
      updatedAt: T,
    });
    await publishHeartbeat(redis, s, {
      nodeId: 'n2',
      onlineCount: 80,
      tickP99Ms: 90,
      draining: false,
      updatedAt: T - HEARTBEAT_TTL_MS,
    });
    const part = {
      partitionId: 'p1',
      realm: 'dawn',
      minX: 0,
      minY: 0,
      maxX: 4095,
      maxY: 4095,
      roomId: 'w1',
      wsUrl: 'ws://x',
      hardCapacity: 100,
      staffBuffer: 5,
      onlineCount: 120,
      draining: false,
      updatedAt: T,
    };
    await publishPartition(redis, s, part);
    await publishHub(redis, s, {
      roomId: 'h1',
      wsUrl: 'ws://x',
      hardCapacity: 100,
      staffBuffer: 5,
      onlineCount: 1,
      draining: false,
      updatedAt: T,
    });
    const live = await readShardLive(redis, s, T + 1000);
    expect(live.nodes.map((n) => n.nodeId)).toEqual(['n1']);
    expect(live.partitions).toEqual([part]);
    expect(live.hub?.roomId).toBe('h1');
    expect((await readShardLive(redis, s, T + 60_000)).hub).toBeNull();
    expect(await readShardLive(redis, shard(), T)).toEqual({
      nodes: [],
      partitions: [],
      hub: null,
    });
    await publishSession(redis, s, 'acc', { characterId: 'c', state: 'online' });
    expect(await readSession(redis, s, 'acc')).toEqual({ characterId: 'c', state: 'online' });
    await publishSession(redis, s, 'acc', null);
    expect(await readSession(redis, s, 'acc')).toBeNull();
  });
});

describe('билеты', () => {
  it('выпуск, однократное погашение, резерв снят', async () => {
    const s = shard();
    const b = bundle(s);
    expect(await issueBundle(redis, b)).toBe('OK');
    expect(await reservedSeats(redis, s, 'w1', T)).toBe(1);
    const keys = await redis.keys('dm:ticket:*');
    expect(keys.some((k) => k.includes(b.world.token))).toBe(false);
    const ok = await redeemTicket(
      redis,
      b.world.token,
      { shardId: s, roomType: 'world', roomId: 'w1' },
      T + 1,
    );
    expect(ok).toEqual({ ok: true, payload: payload(s, 'world') });
    expect(await reservedSeats(redis, s, 'w1', T)).toBe(0);
    expect(
      await redeemTicket(
        redis,
        b.world.token,
        { shardId: s, roomType: 'world', roomId: 'w1' },
        T + 2,
      ),
    ).toEqual({ ok: false, reason: 'INVALID' });
  });

  it('подмена типа комнаты аннулирует билет; истечение', async () => {
    const s = shard();
    const b = bundle(s);
    await issueBundle(redis, b);
    expect(
      await redeemTicket(redis, b.hub.token, { shardId: s, roomType: 'world', roomId: 'w1' }, T),
    ).toEqual({ ok: false, reason: 'ROOM_MISMATCH' });
    expect(
      (await redeemTicket(redis, b.hub.token, { shardId: s, roomType: 'hub', roomId: 'h1' }, T)).ok,
    ).toBe(false);
    expect(
      await redeemTicket(
        redis,
        b.world.token,
        { shardId: s, roomType: 'world', roomId: 'w1' },
        T + 30_000,
      ),
    ).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('эпохи отзыва: аккаунт, герой, шард только для не-персонала', async () => {
    const s = shard();
    const b = bundle(s);
    await issueBundle(redis, b);
    await revokeTickets(redis, 'shard', s, T + 5);
    expect(
      await redeemTicket(
        redis,
        b.world.token,
        { shardId: s, roomType: 'world', roomId: 'w1' },
        T + 6,
      ),
    ).toEqual({ ok: false, reason: 'REVOKED' });
    const gm = bundle(s, {
      bundleId: 'b2',
      world: {
        roomId: 'w1',
        token: `w-${randomUUID()}`,
        payload: payload(s, 'world', { bundleId: 'b2', accessLevel: 'game-master' }),
        free: 10,
      },
    });
    await issueBundle(redis, gm);
    expect(
      (
        await redeemTicket(
          redis,
          gm.world.token,
          { shardId: s, roomType: 'world', roomId: 'w1' },
          T + 7,
        )
      ).ok,
    ).toBe(true);
    const c = shard();
    const cb = bundle(c);
    await issueBundle(redis, cb);
    await revokeTickets(redis, 'char', 'chr', T);
    expect(
      await redeemTicket(redis, cb.hub.token, { shardId: c, roomType: 'hub', roomId: 'h1' }, T + 1),
    ).toEqual({ ok: false, reason: 'REVOKED' });
    await redis.del(KEYS.revoke('char', 'chr'), KEYS.revoke('account', 'acc'));
  });

  it('новый пакет заменяет прежний; переполнение', async () => {
    const s = shard();
    const first = bundle(s);
    await issueBundle(redis, first);
    const second = bundle(s, { bundleId: 'b2' });
    expect(await issueBundle(redis, second)).toBe('OK');
    expect(
      (
        await redeemTicket(
          redis,
          first.world.token,
          { shardId: s, roomType: 'world', roomId: 'w1' },
          T,
        )
      ).ok,
    ).toBe(false);
    expect(await reservedSeats(redis, s, 'w1', T)).toBe(1);
    expect(
      await issueBundle(
        redis,
        bundle(s, {
          accountId: 'other',
          bundleId: 'b3',
          world: { ...second.world, token: 'x1', free: 1 },
        }),
      ),
    ).toBe('FULL_WORLD');
    expect(
      await issueBundle(
        redis,
        bundle(s, {
          accountId: 'other',
          bundleId: 'b4',
          hub: { ...second.hub, token: 'x2', free: 0 },
        }),
      ),
    ).toBe('FULL_HUB');
    expect(await reservedSeats(redis, s, 'w1', T + 30_000)).toBe(0);
  });
});
