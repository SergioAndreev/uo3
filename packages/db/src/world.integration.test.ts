import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DbEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDbClient,
  itemLedger,
  migrateDatabase,
  seedDatabase,
  worldEntities,
} from './index.js';
import {
  DbIdLeaseProvider,
  PartitionLeaseRepo,
  ledgerLineage,
  ledgerOfItem,
  ledgerQuery,
  loadOwnedTree,
  streamPartition,
  writeBatch,
  type WriteRow,
} from './world/index.js';

const cwd = fileURLToPath(new URL('../../..', import.meta.url));
const config = loadServerConfig(DbEnvSchema, { cwd });
const url = new URL(config.DATABASE_TEST_URL ?? '');
if (!url.pathname.endsWith('_test')) throw new Error('нужна база *_test');
const name = 'duskmarch_db_world_test';
const admin = createDbClient(url.href);
url.pathname = `/${name}`;
const client = createDbClient(url.href);

beforeAll(async () => {
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.db.execute(sql.raw(`create database ${name}`));
  await migrateDatabase(client.db);
  await seedDatabase(client.db);
});
afterAll(async () => {
  await client.close();
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.close();
});

const now = new Date();
const item = (entityId: number, extra: Partial<typeof worldEntities.$inferInsert> = {}) => ({
  shardId: 'local-dev',
  entityId,
  kind: 'item',
  contentKey: 'item.rye-bread',
  placement: 'world',
  realm: 'proving',
  x: 10,
  y: 10,
  h: 0,
  createdAt: now,
  updatedAt: now,
  ...extra,
});

/** Код ошибки PostgreSQL из исключения drizzle. */
async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
}

it('ключ (shard, entityId) уникален, в том числе с надгробием', async () => {
  await client.db.insert(worldEntities).values(item(0x6000012a, { deletedAt: now }));
  expect(await pgCode(client.db.insert(worldEntities).values(item(0x6000012a)))).toBe('23505');
  await client.db.insert(worldEntities).values({
    ...item(0x80000001, { kind: 'structure', contentKey: 'structure.stone-house' }),
    rect: { minX: 10, minY: 10, maxX: 17, maxY: 17 },
  });
});

it('размещение: координаты в мире, родитель в контейнере, слот у снаряжения', async () => {
  expect(await pgCode(client.db.insert(worldEntities).values(item(0x60000002, { x: null })))).toBe(
    '23514',
  );
  expect(
    await pgCode(
      client.db
        .insert(worldEntities)
        .values(
          item(0x60000003, { placement: 'container', realm: null, x: null, y: null, h: null }),
        ),
    ),
  ).toBe('23514');
  expect(
    await pgCode(
      client.db.insert(worldEntities).values(
        item(0x60000004, {
          placement: 'equipped',
          parentId: 0x20000001,
          realm: null,
          x: null,
          y: null,
          h: null,
        }),
      ),
    ),
  ).toBe('23514');
  expect(
    await pgCode(client.db.insert(worldEntities).values(item(0x60000005, { placement: 'shelf' }))),
  ).toBe('23514');
  expect(
    await pgCode(client.db.insert(worldEntities).values(item(0x60000006, { amount: 0 }))),
  ).toBe('23514');
});

it('один активный предмет на слот героя', async () => {
  const equipped = {
    placement: 'equipped',
    parentId: 0x20000001,
    slot: 'main-hand',
    rootOwnerId: 0x20000001,
    realm: null,
    x: null,
    y: null,
    h: null,
  };
  await client.db.insert(worldEntities).values(item(0x60000010, equipped));
  expect(await pgCode(client.db.insert(worldEntities).values(item(0x60000011, equipped)))).toBe(
    '23505',
  );
  await client.db.insert(worldEntities).values(item(0x60000012, { ...equipped, deletedAt: now }));
});

it('журнал предметов: секция месяца, только добавление', async () => {
  const month = await client.db.execute<{ name: string }>(
    sql`select item_ledger_ensure_month(now()::date) as name`,
  );
  expect(month.rows[0]?.name).toMatch(/^item_ledger_\d{4}_\d{2}$/);
  const txId = randomUUID();
  await client.db.insert(itemLedger).values({
    shardId: 'local-dev',
    createdAt: now,
    txId,
    txType: 'STAFF_ITEM_GRANT',
    eventKind: 'CREATE',
    itemId: 0x60005000,
    amountDelta: 1,
  });
  const [row] = await client.db.select().from(itemLedger);
  expect(row).toMatchObject({ txId, itemId: 0x60005000 });
  expect(await pgCode(client.db.execute(sql`update item_ledger set amount_delta = 5`))).toBe(
    '42501',
  );
  expect(await pgCode(client.db.execute(sql`delete from item_ledger`))).toBe('42501');
  const parent = await client.db.execute<{ relkind: string }>(
    sql`select relkind from pg_class where relname = 'item_ledger'`,
  );
  expect(parent.rows[0]?.relkind).toBe('p');
});

it('стартовый набор героя ещё не выдан по умолчанию; номера блоков по видам', async () => {
  const cols = await client.db.execute<{ column_name: string; column_default: string }>(
    sql`select column_name, column_default from information_schema.columns where table_name in ('characters', 'shard_entity_sequences') and column_name in ('starter_loadout_granted', 'next_item', 'next_creature', 'next_structure') order by column_name`,
  );
  expect(cols.rows.map((r) => [r.column_name, r.column_default])).toEqual([
    ['next_creature', '1'],
    ['next_item', '1'],
    ['next_structure', '1'],
    ['starter_loadout_granted', 'false'],
  ]);
});

describe('репозитории мира', () => {
  it('аренда идентификаторов: параллельные блоки без пересечений, восстановление выше надгробий', async () => {
    const ids = new DbIdLeaseProvider(client.db, 'ember');
    const recovered = await ids.recover();
    expect(recovered.item).toBe(1);
    const [a, b] = await Promise.all([ids.lease('item', 4_096), ids.lease('item', 4_096)]);
    const blocks = [a, b].sort((x, y) => x.from - y.from);
    expect(blocks).toEqual([
      { kind: 'item', from: 1, to: 4_097 },
      { kind: 'item', from: 4_097, to: 8_193 },
    ]);
    await client.db
      .insert(worldEntities)
      .values(item(0x60000000 + 9_000, { shardId: 'ember', deletedAt: now }));
    const again = await new DbIdLeaseProvider(client.db, 'ember').recover();
    expect(again.item).toBe(9_001);
    expect((await ids.lease('item', 256)).from).toBe(9_001);
    await expect(ids.lease('hero', 256)).rejects.toMatchObject({
      code: 'PERSIST_ENTITY_ID_RANGE_EXHAUSTED',
    });
  });

  it('аренда идентификаторов: заполнение 80/95 % и исчерпание', async () => {
    const fills: number[] = [];
    const ids = new DbIdLeaseProvider(client.db, 'ember', (_k, p) => fills.push(p));
    await client.db.execute(
      sql`update shard_entity_sequences set next_structure = ${Math.floor(0x1fffffff * 0.85)} where shard_id = 'ember'`,
    );
    await ids.lease('structure', 256);
    await client.db.execute(
      sql`update shard_entity_sequences set next_structure = ${0x1fffffff - 100} where shard_id = 'ember'`,
    );
    const last = await ids.lease('structure', 256);
    expect(last.to).toBe(0x20000000);
    expect(fills).toEqual([80, 95]);
    await expect(ids.lease('structure', 256)).rejects.toMatchObject({
      code: 'PERSIST_ENTITY_ID_RANGE_EXHAUSTED',
    });
  });

  it('аренда партиции: захват, занято, устаревшая эпоха, захват после истечения', async () => {
    const a = new PartitionLeaseRepo(client.db, 'local-dev', 'dusk-0');
    const t0 = new Date('2026-11-26T10:00:00Z');
    const first = await a.acquire('node-a', 15_000, t0);
    expect(first.epoch).toBe(1);
    await expect(a.acquire('node-b', 15_000, new Date(t0.getTime() + 5_000))).rejects.toMatchObject(
      {
        code: 'PERSIST_PARTITION_LEASE_HELD',
        details: { ownerNodeId: 'node-a' },
      },
    );
    expect(await a.renew(1, 15_000, new Date(t0.getTime() + 5_000))).toBe(true);
    const second = await a.acquire('node-b', 15_000, new Date(t0.getTime() + 21_000));
    expect(second.epoch).toBe(2);
    expect(await a.renew(1, 15_000)).toBe(false);
    await expect(client.db.transaction((tx) => a.assertEpoch(tx, 1))).rejects.toMatchObject({
      code: 'PERSIST_FENCING_TOKEN_STALE',
    });
    await client.db.transaction((tx) => a.assertEpoch(tx, 2));
    await a.release(2);
    expect((await a.acquire('node-c', 15_000)).epoch).toBe(3);
  });

  it('пакетная запись: вставка, обновление по версии, конфликт, повтор идентификатора', async () => {
    const row = (entityId: number, extra: Partial<WriteRow['row']> = {}): WriteRow['row'] => ({
      ...item(entityId, { shardId: 'ember', realm: 'dusk' }),
      ...extra,
    });
    const first = await writeBatch(client.db, [
      { row: row(0x60010001), expectedVersion: 0 },
      {
        row: row(0x60010002, {
          placement: 'container',
          parentId: 0x60010001,
          rootOwnerId: 0x60010001,
          realm: null,
          x: null,
          y: null,
          h: null,
        }),
        expectedVersion: 0,
      },
    ]);
    expect(first.written.sort()).toEqual([0x60010001, 0x60010002]);
    const second = await writeBatch(client.db, [
      { row: row(0x60010001, { x: 11 }), expectedVersion: 1 },
      {
        row: row(0x60010002, {
          amount: 5,
          placement: 'container',
          parentId: 0x60010001,
          rootOwnerId: 0x60010001,
          realm: null,
          x: null,
          y: null,
          h: null,
        }),
        expectedVersion: 3,
      },
      { row: row(0x6000012a, { shardId: 'local-dev' }), expectedVersion: 0 },
    ]);
    expect(second.written).toEqual([0x60010001]);
    expect(second.conflicts.sort()).toEqual([0x6000012a, 0x60010002]);
    const tree = await loadOwnedTree(client.db, 'ember', 0x60010001);
    expect(tree.map((r) => [r.entityId, r.entityVersion])).toEqual([[0x60010002, 1]]);
  });

  it('потоковая загрузка: только план и границы, содержимое контейнеров, пакеты', async () => {
    const rows: WriteRow[] = [];
    for (let i = 0; i < 30; i++)
      rows.push({
        row: item(0x60020000 + i, {
          shardId: 'ember',
          realm: i < 20 ? 'dusk' : 'dawn',
          x: 100 + i,
          y: 100,
        }),
        expectedVersion: 0,
      });
    rows.push({
      row: item(0x60020100, { shardId: 'ember', realm: 'dusk', x: 5_000, y: 5_000 }),
      expectedVersion: 0,
    });
    rows.push({
      row: item(0x60020200, {
        shardId: 'ember',
        placement: 'container',
        parentId: 0x60020003,
        rootOwnerId: 0x60020003,
        realm: null,
        x: null,
        y: null,
        h: null,
      }),
      expectedVersion: 0,
    });
    await writeBatch(client.db, rows);
    const batches: number[][] = [];
    for await (const batch of streamPartition(
      client.db,
      'ember',
      'dusk',
      { minX: 0, minY: 0, maxX: 1_023, maxY: 1_023 },
      8,
    )) {
      batches.push(batch.map((r) => r.entityId));
    }
    const all = batches.flat();
    expect(all).toContain(0x60020200);
    expect(all).not.toContain(0x60020100);
    expect(all.filter((id) => id >= 0x60020000 && id < 0x60020100)).toHaveLength(20);
    expect(batches.length).toBeGreaterThan(2);
  });
});

it('журнал: история предмета, цепочка происхождения в обе стороны, курсор', async () => {
  const tx = randomUUID();
  const base = {
    shardId: 'ember',
    txId: tx,
    txType: 'TRADE_EXCHANGE',
    createdAt: now,
    characterId: '7d0e2a8e-1c7e-4c49-9a5f-2b4a1f0e9d11',
  };
  await client.db.insert(itemLedger).values([
    { ...base, eventKind: 'CREATE', itemId: 0x60500000, amountDelta: 1_000 },
    { ...base, eventKind: 'SPLIT', itemId: 0x60500000, amountDelta: -300 },
    {
      ...base,
      eventKind: 'CREATE',
      itemId: 0x60500001,
      sourceItemId: 0x60500000,
      amountDelta: 300,
    },
    {
      ...base,
      eventKind: 'CREATE',
      itemId: 0x60500002,
      sourceItemId: 0x60500001,
      amountDelta: 100,
    },
    { ...base, eventKind: 'CREATE', itemId: 0x60500099, amountDelta: 1, characterId: null },
  ]);
  expect((await ledgerOfItem(client.db, 'ember', 0x60500000)).map((r) => r.eventKind)).toEqual([
    'CREATE',
    'SPLIT',
  ]);
  const lineage = await ledgerLineage(client.db, 'ember', 0x60500001);
  expect(lineage.items).toEqual([0x60500000, 0x60500001, 0x60500002]);
  expect(lineage.events).toHaveLength(4);
  const page = await ledgerQuery(client.db, 'ember', { characterId: base.characterId, limit: 3 });
  expect(page.events).toHaveLength(3);
  const rest = await ledgerQuery(client.db, 'ember', {
    characterId: base.characterId,
    limit: 3,
    after: page.next as number,
  });
  expect(rest).toMatchObject({
    next: null,
    events: [expect.objectContaining({ itemId: 0x60500002 })],
  });
  expect((await ledgerQuery(client.db, 'ember', { txId: tx, limit: 100 })).events).toHaveLength(5);
});
