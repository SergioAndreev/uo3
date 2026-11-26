import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DbEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createDbClient,
  itemLedger,
  migrateDatabase,
  seedDatabase,
  worldEntities,
} from './index.js';

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
