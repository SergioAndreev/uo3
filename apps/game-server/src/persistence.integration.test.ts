import { fileURLToPath } from 'node:url';
import { DbEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { createDbClient, migrateDatabase, seedDatabase, worldEntities } from '@duskmarch/db';
import type { EntityId } from '@duskmarch/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { initShardState, listTimers } from '@duskmarch/db/world';
import { Scheduler } from './engine/scheduler.js';
import { loadHeroTree, loadPartition, quarantineRows } from './persistence/loader.js';
import { TimerStore } from './persistence/timer-store.js';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const dbConfig = loadServerConfig(DbEnvSchema, { cwd: root });
const url = new URL(dbConfig.DATABASE_TEST_URL ?? '');
if (!url.pathname.endsWith('_test')) throw new Error('нужна база *_test');
const name = 'duskmarch_game_persistence_test';
const admin = createDbClient(url.href);
url.pathname = `/${name}`;
const client = createDbClient(url.href);

beforeAll(async () => {
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.db.execute(sql.raw(`create database ${name}`));
  await migrateDatabase(client.db);
  await seedDatabase(client.db);
}, 60_000);

afterAll(async () => {
  await client.close();
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.close();
});

it('потоковая загрузка 100 000 сущностей партиции в бюджете 10 с', async () => {
  await client.db.execute(sql`
    INSERT INTO world_entities (shard_id, entity_id, kind, content_key, placement, realm, x, y, h, created_at, updated_at)
    SELECT 'ember', 1610612736 + g, 'item', 'item.rye-bread', 'world', 'dusk', g % 4096, (g / 4096) % 4096, 0, now(), now()
    FROM generate_series(1, 100000) AS g`);
  await client.db.execute(sql`
    INSERT INTO world_entities (shard_id, entity_id, kind, content_key, placement, realm, x, y, h, created_at, updated_at)
    SELECT 'ember', 1610612736 + 200000 + g, 'item', 'item.rye-bread', 'world', 'dawn', g, 0, 0, now(), now()
    FROM generate_series(1, 1000) AS g`);
  const report = await loadPartition(client.db, 'ember', 'dusk', {
    minX: 0,
    minY: 0,
    maxX: 4_095,
    maxY: 4_095,
  });
  expect(report.entities).toHaveLength(100_000);
  expect(report.batches).toBe(20);
  expect(report.durationMs).toBeLessThan(10_000);
}, 120_000);

it('карантин в БД: limbo с исходным родителем; дерево героя одним запросом', async () => {
  const now = new Date();
  const hero = 0x20000005;
  const base = {
    shardId: 'local-dev',
    kind: 'item',
    contentKey: 'item.rye-bread',
    createdAt: now,
    updatedAt: now,
  };
  await client.db.insert(worldEntities).values([
    {
      ...base,
      entityId: 0x60100001,
      placement: 'equipped',
      parentId: hero,
      slot: 'pack',
      rootOwnerId: hero,
    },
    {
      ...base,
      entityId: 0x60100002,
      placement: 'container',
      parentId: 0x60100001,
      rootOwnerId: hero,
    },
    { ...base, entityId: 0x60100003, placement: 'world', realm: 'proving', x: 5, y: 5, h: 0 },
    {
      ...base,
      entityId: 0x60100004,
      placement: 'container',
      parentId: 0x60109999,
      rootOwnerId: 0x60100003,
    },
  ]);
  const tree = await loadHeroTree(client.db, 'local-dev', hero as EntityId);
  expect(tree.map((e) => e.id)).toEqual([0x60100001, 0x60100002]);
  const report = await loadPartition(client.db, 'local-dev', 'proving', {
    minX: 0,
    minY: 0,
    maxX: 63,
    maxY: 63,
  });
  expect(report.quarantined.map((q) => q.row.entityId)).toEqual([0x60100004]);
  expect(await quarantineRows(client.db, report.quarantined)).toBe(1);
  const [moved] = await client.db
    .select()
    .from(worldEntities)
    .where(eq(worldEntities.entityId, 0x60100004));
  expect(moved).toMatchObject({
    placement: 'limbo',
    parentId: null,
    entityVersion: 2,
    components: { quarantine: { parentId: 0x60109999 } },
  });
  await expect(
    loadPartition(
      client.db,
      'local-dev',
      'proving',
      { minX: 0, minY: 0, maxX: 63, maxY: 63 },
      { mode: 'strict' },
    ),
  ).resolves.toMatchObject({ quarantined: [] });
});

it('состояние шарда: идемпотентная инициализация', async () => {
  const init = {
    shardId: 'local-dev',
    worldVersion: 'a'.repeat(64),
    rulesetFingerprint: 'b'.repeat(64),
    rngState: '0'.repeat(31) + '1',
  };
  const first = await initShardState(client.db, init);
  const second = await initShardState(client.db, { ...init, worldVersion: 'c'.repeat(64) });
  expect(second).toMatchObject({
    worldVersion: 'a'.repeat(64),
    gameTimeMs: 0,
    createdAt: first.createdAt,
  });
});

it('таймеры: создание, срабатывание, сохранение остатка и восстановление после простоя', async () => {
  let now = new Date('2026-11-26T10:00:00Z');
  const scheduler = new Scheduler({ perfNow: () => 0 });
  const fired: string[] = [];
  const store = new TimerStore(client.db, 'local-dev', scheduler, () => now);
  store.on('decay', (t) => fired.push(t.id));
  const fast = await store.create('decay', 100, 'pause', 0x60000001 as never);
  const slow = await store.create('decay', 20 * 60_000, 'pause');
  scheduler.advance(2);
  await new Promise((r) => setTimeout(r, 50));
  expect(fired).toEqual([fast]);
  scheduler.advance(20);
  await store.persist();
  const [saved] = await listTimers(client.db, 'local-dev');
  expect(saved).toMatchObject({ id: slow, remainingMs: 20 * 60_000 - 1_100 });
  now = new Date(now.getTime() + 45 * 60_000);
  const restarted = new Scheduler({ perfNow: () => 0 });
  const after = new TimerStore(client.db, 'local-dev', restarted, () => now);
  after.on('decay', (t) => fired.push(t.id));
  expect(await after.restore()).toBe(1);
  restarted.advance((20 * 60_000 - 1_100) / 50 - 1);
  expect(fired).toEqual([fast]);
  restarted.advance(1);
  expect(fired).toEqual([fast, slow]);
  await store.cancel(fast);
});
