import { fileURLToPath } from 'node:url';
import { DbEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { createDbClient, migrateDatabase, seedDatabase, worldEntities } from '@duskmarch/db';
import type { EntityId } from '@duskmarch/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PartitionLeaseRepo, initShardState, listTimers } from '@duskmarch/db/world';
import { dbBatchWriter, entityToRow } from './persistence/flush-store.js';
import { IdAllocator, InMemoryIdLeaseProvider } from '@duskmarch/domain';
import { itemLedger } from '@duskmarch/db';
import { PartitionCore, type Entity } from './engine/partition.js';
import { CriticalTransactionCoordinator } from './persistence/critical.js';
import { dbCriticalPorts } from './persistence/critical-store.js';
import { DirtyTracker } from './persistence/dirty-tracker.js';
import type { WorldRowOut } from './persistence/flush.js';
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

it('запись пакета: контейнер и содержимое, обновление по версии, мягкое удаление, устаревшая эпоха', async () => {
  const lease = new PartitionLeaseRepo(client.db, 'local-dev', 'proving-0');
  const { epoch } = await lease.acquire('node-a', 15_000);
  let current = epoch;
  const write = dbBatchWriter(client.db, 'local-dev', lease, () => current);
  const now = new Date();
  const base = {
    shardId: 'local-dev',
    kind: 'item',
    contentKey: 'item.oak-chest',
    realm: null,
    x: null,
    y: null,
    h: null,
    slot: null,
    rect: null,
    amount: 1,
    components: {},
    schemaVersion: 1,
    changeSeq: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const chest = {
    ...base,
    entityId: 0x60200000,
    placement: 'world',
    realm: 'proving',
    x: 3,
    y: 3,
    h: 0,
    parentId: null,
    rootOwnerId: null,
  };
  const inner = {
    ...base,
    entityId: 0x60200001,
    contentKey: 'item.rye-bread',
    placement: 'container',
    parentId: 0x60200000,
    rootOwnerId: 0x60200000,
  };
  const first = await write({
    upserts: [
      { row: chest, expectedVersion: 0 },
      { row: inner, expectedVersion: 0 },
    ],
    deletes: [],
  });
  expect(first.written.sort()).toEqual([0x60200000, 0x60200001]);
  const second = await write({
    upserts: [{ row: { ...chest, x: 4 }, expectedVersion: 1 }],
    deletes: [
      { entityId: 0x60200001, expectedVersion: 1 },
      { entityId: 0x60200099, expectedVersion: 1 },
    ],
  });
  expect(second).toEqual({ written: [0x60200000], deleted: [0x60200001], conflicts: [0x60200099] });
  const [gone] = await client.db
    .select()
    .from(worldEntities)
    .where(eq(worldEntities.entityId, 0x60200001));
  expect(gone).toMatchObject({ entityVersion: 2, deletedAt: expect.any(Date) });
  await lease.acquire('node-a', 15_000);
  await expect(
    write({ upserts: [{ row: { ...chest, x: 5 }, expectedVersion: 2 }], deletes: [] }),
  ).rejects.toMatchObject({ code: 'PERSIST_FENCING_TOKEN_STALE' });
  current = epoch + 1;
  await expect(
    write({ upserts: [{ row: { ...chest, x: 5 }, expectedVersion: 2 }], deletes: [] }),
  ).resolves.toMatchObject({ written: [0x60200000] });
});

it('критическая транзакция: коммит → «аварийное завершение» → загрузка видит обмен без потерь и копий', async () => {
  const A = 0x20000011 as EntityId;
  const B = 0x20000012 as EntityId;
  const now = new Date();
  const base = { shardId: 'local-dev', kind: 'item', createdAt: now, updatedAt: now };
  await client.db.insert(worldEntities).values([
    {
      ...base,
      entityId: 0x60300001,
      contentKey: 'item.blade',
      placement: 'equipped',
      parentId: A,
      slot: 'main-hand',
      rootOwnerId: A,
    },
    {
      ...base,
      entityId: 0x60300002,
      contentKey: 'item.copper-coin',
      amount: 5_000,
      placement: 'equipped',
      parentId: B,
      slot: 'pack',
      rootOwnerId: B,
    },
  ]);
  const lease = new PartitionLeaseRepo(client.db, 'local-dev', 'proving-9');
  const { epoch } = await lease.acquire('node-a', 15_000);
  const allocator = new IdAllocator(new InMemoryIdLeaseProvider({ item: 0x400000 }), {
    leaseSize: 256,
  });
  await allocator.ready();
  let tracker: DirtyTracker<WorldRowOut> | null = null;
  const core = new PartitionCore({
    partitionId: 'proving-9',
    realm: { key: 'proving', width: 64, height: 64 },
    bounds: { minX: 0, minY: 0, maxX: 63, maxY: 63 },
    allocator,
    onDirty: (id, r) => tracker?.onDirty(id, r),
  });
  const items = [
    ...(await loadHeroTree(client.db, 'local-dev', A)),
    ...(await loadHeroTree(client.db, 'local-dev', B)),
  ];
  core.hydrate([
    {
      id: A,
      kind: 'hero',
      placement: { kind: 'world', x: 5, y: 5, h: 0 },
      player: true,
      height: 7,
      blocksSight: false,
      behaviors: [],
    },
    {
      id: B,
      kind: 'hero',
      placement: { kind: 'world', x: 6, y: 5, h: 0 },
      player: true,
      height: 7,
      blocksSight: false,
      behaviors: [],
    },
    ...items,
  ]);
  const serialize = (e: Entity) => entityToRow('local-dev', 'proving', e, (id) => core.get(id));
  tracker = new DirtyTracker(core, serialize);
  const crit = new CriticalTransactionCoordinator(
    core,
    tracker,
    dbCriticalPorts(client.db, 'local-dev', 'proving', lease, () => epoch, serialize),
    (k) => allocator.next(k),
  );
  const out = await crit.run({
    type: 'TRADE_EXCHANGE',
    idempotencyKey: 'trade-1',
    participants: [0x60300001 as EntityId, 0x60300002 as EntityId],
    payload: { amount: 300 },
    plan: (get, newId) => {
      const sword = get(0x60300001 as EntityId) as Entity;
      const stack = get(0x60300002 as EntityId) as Entity;
      sword.placement = { kind: 'equipped', holder: B, slot: 'main-hand' };
      const paid: Entity = {
        ...stack,
        id: newId('item'),
        placement: { kind: 'equipped', holder: A, slot: 'pack' },
        data: { ...stack.data!, amount: 300, entityVersion: 0 },
      };
      return {
        upserts: [sword, { ...stack, data: { ...stack.data!, amount: 4_700 } }, paid],
        deletes: [],
        ledger: [
          { eventKind: 'TRANSFER', itemId: sword.id, fromOwnerId: A, toOwnerId: B },
          { eventKind: 'SPLIT', itemId: stack.id, amountDelta: -300 },
          {
            eventKind: 'CREATE',
            itemId: paid.id,
            sourceItemId: stack.id,
            amountDelta: 300,
            toOwnerId: A,
          },
        ],
        result: { paid: paid.id },
      };
    },
  });
  // «SIGKILL»: память отбрасывается, состояние читается из БД заново.
  const treeA = await loadHeroTree(client.db, 'local-dev', A);
  const treeB = await loadHeroTree(client.db, 'local-dev', B);
  expect(treeA.map((e) => [e.data?.contentKey, e.data?.amount])).toEqual([
    ['item.copper-coin', 300],
  ]);
  expect(treeB.map((e) => [e.data?.contentKey, e.data?.amount]).sort()).toEqual([
    ['item.blade', 1],
    ['item.copper-coin', 4_700],
  ]);
  const ledger = await client.db.select().from(itemLedger).where(eq(itemLedger.txId, out.txId));
  expect(ledger.map((l) => l.eventKind).sort()).toEqual(['CREATE', 'SPLIT', 'TRANSFER']);
  expect(ledger.find((l) => l.eventKind === 'CREATE')?.sourceItemId).toBe(0x60300002);
  const again = await crit.run({
    type: 'TRADE_EXCHANGE',
    idempotencyKey: 'trade-1',
    participants: [0x60300001 as EntityId, 0x60300002 as EntityId],
    payload: { amount: 300 },
    plan: () => ({ upserts: [], deletes: [], ledger: [] }),
  });
  expect(again).toMatchObject({ txId: out.txId, replayed: true });
});
