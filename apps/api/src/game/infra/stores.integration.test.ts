import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ApiEnvSchema, DbEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { accounts, createDbClient, migrateDatabase } from '@duskmarch/db';
import { publishHeartbeat, publishSession } from '@duskmarch/db/live';
import { sql } from 'drizzle-orm';
import { Redis } from 'iovalkey';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { gameStoreContract } from '../contracts.test-helper.js';
import { shardRecord } from '../game-harness.test-helper.js';
import { DrizzleGameStore } from './drizzle-store.js';
import { ValkeyLive } from './valkey-live.js';

const root = fileURLToPath(new URL('../../../../..', import.meta.url));
const db = loadServerConfig(DbEnvSchema, { cwd: root });
const api = loadServerConfig(ApiEnvSchema, {
  cwd: fileURLToPath(new URL('../../..', import.meta.url)),
});
const url = new URL(db.DATABASE_TEST_URL ?? '');
if (!url.pathname.endsWith('_test')) throw new Error('нужна база *_test');
const name = 'duskmarch_api_game_test';
const admin = createDbClient(url.href);
url.pathname = `/${name}`;
const client = createDbClient(url.href);
const redis = new Redis(
  api.VALKEY_URL,
  api.VALKEY_PASSWORD ? { password: api.VALKEY_PASSWORD } : {},
);

beforeAll(async () => {
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.db.execute(sql.raw(`create database ${name}`));
  await migrateDatabase(client.db);
  await new DrizzleGameStore(client.db).insertShard(shardRecord());
});
afterAll(async () => {
  redis.disconnect();
  await client.close();
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.close();
});

gameStoreContract('PostgreSQL', async () => ({
  store: new DrizzleGameStore(client.db),
  account: async () => {
    const id = randomUUID();
    const now = new Date();
    await client.db
      .insert(accounts)
      .values({ id, email: `${id}@example.com`, status: 'active', createdAt: now, updatedAt: now });
    return id;
  },
}));

it('ValkeyLive: чтение, сессия, выпуск, резервы, отзыв', async () => {
  const live = new ValkeyLive(redis);
  const shard = `g-${randomUUID().slice(0, 8)}`;
  const now = Date.now();
  await publishHeartbeat(redis, shard, {
    nodeId: 'n',
    onlineCount: 3,
    tickP99Ms: 5,
    draining: false,
    updatedAt: now,
  });
  expect((await live.read(shard, now)).nodes).toHaveLength(1);
  await publishSession(redis, shard, 'acc', { characterId: 'c', state: 'online' });
  expect(await live.session(shard, 'acc')).toEqual({ characterId: 'c', state: 'online' });
  const result = await live.issue({
    shardId: shard,
    accountId: 'acc',
    bundleId: 'b',
    world: { roomId: 'w', token: randomUUID(), payload: {}, free: 5 },
    hub: { roomId: 'h', token: randomUUID(), payload: {}, free: 5 },
    ttlMs: 10_000,
    now,
  });
  expect(result).toBe('OK');
  expect(await live.reserved(shard, 'w', now)).toBe(1);
  await live.revoke('shard', shard, now);
  expect(await redis.get(`dm:revoke:shard:${shard}`)).toBe(String(now));
});
