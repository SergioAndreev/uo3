import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DbEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  accounts,
  characterSkills,
  characters,
  createDbClient,
  itemLedger,
  migrateDatabase,
  partitionLeases,
  restoreOperations,
  seedDatabase,
  shardEntitySequences,
  shards,
  worldEntities,
} from './index.js';
import {
  heroDiff,
  heroSnapshot,
  reconcileShard,
  restoreHero,
  restoreItem,
  undoRestore,
} from './world/index.js';

const cwd = fileURLToPath(new URL('../../..', import.meta.url));
const config = loadServerConfig(DbEnvSchema, { cwd });
const url = new URL(config.DATABASE_TEST_URL ?? '');
if (!url.pathname.endsWith('_test')) throw new Error('нужна база *_test');
const name = 'duskmarch_db_restore_test';
const admin = createDbClient(url.href);
url.pathname = `/${name}`;
const client = createDbClient(url.href);
const db = client.db;
const now = new Date('2026-11-26T12:00:00Z');
const actorId = randomUUID();
const actor = {
  accountId: actorId,
  accessLevel: 'administrator',
  reason: 'Возврат после взлома аккаунта',
};

async function hero(entityId: number) {
  const accountId = randomUUID();
  const id = randomUUID();
  await db.insert(accounts).values({
    id: accountId,
    email: `${accountId}@example.com`,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(characters).values({
    id,
    shardId: 'ember',
    accountId,
    entityId,
    slot: 0,
    name: `Г${entityId % 1000}`,
    nameKey: `г${entityId % 1000}`,
    status: 'active',
    stats: { might: 30, finesse: 30, will: 30 },
    appearance: {},
    startCity: 'lad',
    realm: 'dawn',
    x: 10,
    y: 10,
    h: 0,
    starterLoadout: [],
    createdAt: now,
  });
  await db.insert(characterSkills).values({ characterId: id, skill: 'edge', tenths: 300 });
  return { id, entityId };
}

const item = (
  entityId: number,
  owner: number,
  extra: Partial<typeof worldEntities.$inferInsert> = {},
) => ({
  shardId: 'ember',
  entityId,
  kind: 'item',
  contentKey: 'item.short-blade',
  placement: 'equipped',
  parentId: owner,
  slot: 'main-hand',
  rootOwnerId: owner,
  createdAt: now,
  updatedAt: now,
  ...extra,
});

beforeAll(async () => {
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.db.execute(sql.raw(`create database ${name}`));
  await migrateDatabase(db);
  await seedDatabase(db);
  await db.insert(accounts).values({
    id: actorId,
    email: 'restore-admin@example.com',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
});
afterAll(async () => {
  await client.close();
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.close();
});

it('откат героя к метке T: характеристики, навыки, предметы; журнал; отмена возвращает прежнее', async () => {
  const h = await hero(0x20000101);
  await db.insert(worldEntities).values([
    item(0x60700001, h.entityId),
    item(0x60700002, h.entityId, {
      contentKey: 'item.copper-coin',
      amount: 500,
      placement: 'container',
      parentId: 0x60700009,
      slot: null,
    }),
  ]);
  await db
    .insert(worldEntities)
    .values(item(0x60700009, h.entityId, { contentKey: 'item.satchel', slot: 'pack' }));
  const atT = (await heroSnapshot(db, 'ember', h.id))!;
  // «Взлом»: клинок продан, монеты потрачены, появился чужой предмет, навык изменён.
  await db
    .update(worldEntities)
    .set({ deletedAt: now })
    .where(eq(worldEntities.entityId, 0x60700001));
  await db.update(worldEntities).set({ amount: 5 }).where(eq(worldEntities.entityId, 0x60700002));
  await db
    .insert(worldEntities)
    .values(item(0x60700003, h.entityId, { contentKey: 'item.rye-bread', slot: 'off-hand' }));
  await db.update(characterSkills).set({ tenths: 10 }).where(eq(characterSkills.characterId, h.id));
  await db.update(characters).set({ x: 99 }).where(eq(characters.id, h.id));
  const current = (await heroSnapshot(db, 'ember', h.id))!;
  const diff = heroDiff(current, atT);
  expect(diff).toMatchObject({
    character: ['x'],
    skills: ['edge'],
    itemsRestored: [0x60700001],
    itemsRemoved: [0x60700003],
    itemsChanged: [0x60700002],
  });
  const op = await restoreHero(db, { shardId: 'ember', target: atT, targetTime: now, actor });
  const after = (await heroSnapshot(db, 'ember', h.id))!;
  expect(after.character.x).toBe(10);
  expect(after.skills).toEqual([{ skill: 'edge', tenths: 300 }]);
  expect(after.items.map((i) => [i.entityId, i.amount])).toEqual([
    [0x60700001, 1],
    [0x60700002, 500],
    [0x60700009, 1],
  ]);
  const ledger = await db.select().from(itemLedger).where(eq(itemLedger.txId, op.txId));
  expect(ledger.map((l) => l.eventKind).sort()).toEqual([
    'DESTROY',
    'RESTORE',
    'RESTORE',
    'RESTORE',
  ]);
  expect(ledger[0]).toMatchObject({ actorAccountId: actorId, actorAccessLevel: 'administrator' });
  const undo = await undoRestore(db, { shardId: 'ember', operationId: op.operationId, actor });
  const undone = (await heroSnapshot(db, 'ember', h.id))!;
  expect(undone.character.x).toBe(99);
  expect(undone.items.map((i) => i.entityId).sort()).toEqual([0x60700002, 0x60700003, 0x60700009]);
  const [orig] = await db
    .select()
    .from(restoreOperations)
    .where(eq(restoreOperations.id, op.operationId));
  expect(orig?.undoneAt).not.toBeNull();
  const [undoRow] = await db
    .select()
    .from(restoreOperations)
    .where(eq(restoreOperations.id, undo.operationId));
  expect(undoRow).toMatchObject({ undoOf: op.operationId, mode: 'undo' });
  await expect(
    undoRestore(db, { shardId: 'ember', operationId: op.operationId, actor }),
  ).rejects.toMatchObject({ code: 'PERSIST_TX_CONFLICT' });
  await expect(
    undoRestore(db, {
      shardId: 'ember',
      operationId: undo.operationId,
      actor,
      now: new Date(now.getTime() + 31 * 86_400_000),
    }),
  ).rejects.toMatchObject({ code: 'PERSIST_ROLLBACK_UNDO_EXPIRED' });
});

it('откат героя: предмет из снимка активен у другого героя — конфликт без изменений', async () => {
  const a = await hero(0x20000102);
  const b = await hero(0x20000103);
  await db.insert(worldEntities).values(item(0x60700010, a.entityId));
  const atT = (await heroSnapshot(db, 'ember', a.id))!;
  await db
    .update(worldEntities)
    .set({ parentId: b.entityId, rootOwnerId: b.entityId })
    .where(eq(worldEntities.entityId, 0x60700010));
  await expect(
    restoreHero(db, { shardId: 'ember', target: atT, targetTime: now, actor }),
  ).rejects.toMatchObject({
    code: 'PERSIST_RESTORE_DUPE_CONFLICT',
    details: { items: [{ id: 0x60700010, owner: b.entityId }] },
  });
  const [row] = await db.select().from(worldEntities).where(eq(worldEntities.entityId, 0x60700010));
  expect(row?.rootOwnerId).toBe(b.entityId);
});

it('восстановление предмета: надгробие → банк; активный у другого — конфликт, изъятие или новый идентификатор', async () => {
  const a = await hero(0x20000104);
  const b = await hero(0x20000105);
  await db
    .insert(worldEntities)
    .values([
      item(0x60700020, a.entityId, { deletedAt: now }),
      item(0x60700021, b.entityId, { slot: 'off-hand' }),
    ]);
  const restored = await restoreItem(db, {
    shardId: 'ember',
    itemId: 0x60700020,
    toCharacterId: a.id,
    mode: 'strict_no_conflict',
    actor,
  });
  const [r] = await db.select().from(worldEntities).where(eq(worldEntities.entityId, 0x60700020));
  expect(r).toMatchObject({
    placement: 'bank',
    parentId: a.entityId,
    rootOwnerId: a.entityId,
    deletedAt: null,
    entityVersion: 2,
  });
  expect(
    (await db.select().from(itemLedger).where(eq(itemLedger.txId, restored.txId)))[0]?.eventKind,
  ).toBe('RESTORE');
  await expect(
    restoreItem(db, {
      shardId: 'ember',
      itemId: 0x60700021,
      toCharacterId: a.id,
      mode: 'strict_no_conflict',
      actor,
    }),
  ).rejects.toMatchObject({
    code: 'PERSIST_RESTORE_DUPE_CONFLICT',
    details: { currentOwner: b.entityId },
  });
  const reissued = await restoreItem(db, {
    shardId: 'ember',
    itemId: 0x60700021,
    toCharacterId: a.id,
    mode: 'reissue_new_id',
    actor,
    newId: async () => 0x60700099,
  });
  expect(reissued.itemId).toBe(0x60700099);
  const copies = await db
    .select()
    .from(worldEntities)
    .where(
      and(
        eq(worldEntities.contentKey, 'item.short-blade'),
        sql`${worldEntities.entityId} IN (${0x60700021}, ${0x60700099})`,
      ),
    );
  expect(copies.map((c) => [c.entityId, c.rootOwnerId]).sort()).toEqual([
    [0x60700021, b.entityId],
    [0x60700099, a.entityId],
  ]);
  const reclaimed = await restoreItem(db, {
    shardId: 'ember',
    itemId: 0x60700021,
    toCharacterId: a.id,
    mode: 'reclaim_original',
    actor,
  });
  expect(reclaimed.previousOwner).toBe(b.entityId);
  const [moved] = await db
    .select()
    .from(worldEntities)
    .where(eq(worldEntities.entityId, 0x60700021));
  expect(moved).toMatchObject({ rootOwnerId: a.entityId, placement: 'bank' });
  await undoRestore(db, { shardId: 'ember', operationId: reclaimed.operationId, actor });
  const [back] = await db
    .select()
    .from(worldEntities)
    .where(eq(worldEntities.entityId, 0x60700021));
  expect(back).toMatchObject({ rootOwnerId: b.entityId, placement: 'equipped' });
});

it('восстановление предмета с активной производной стопкой — конфликт в строгом режиме', async () => {
  const a = await hero(0x20000106);
  await db
    .insert(worldEntities)
    .values([
      item(0x60700030, a.entityId, { deletedAt: now, contentKey: 'item.copper-coin' }),
      item(0x60700031, a.entityId, { contentKey: 'item.copper-coin', slot: 'pack' }),
    ]);
  await db.insert(itemLedger).values({
    shardId: 'ember',
    txId: randomUUID(),
    txType: 'TRADE_EXCHANGE',
    eventKind: 'CREATE',
    itemId: 0x60700031,
    sourceItemId: 0x60700030,
    createdAt: now,
  });
  await expect(
    restoreItem(db, {
      shardId: 'ember',
      itemId: 0x60700030,
      toCharacterId: a.id,
      mode: 'strict_no_conflict',
      actor,
    }),
  ).rejects.toMatchObject({
    code: 'PERSIST_RESTORE_DUPE_CONFLICT',
    details: { derived: [0x60700031] },
  });
});

it('сверка после PITR: аренды сброшены, границы +4096, распад продлён; дефект — обслуживание', async () => {
  await db.insert(partitionLeases).values({
    shardId: 'ember',
    partitionId: 'dawn-0',
    ownerNodeId: 'old',
    epoch: 4,
    acquiredAt: now,
    expiresAt: new Date(now.getTime() + 15_000),
  });
  await db.insert(shardEntitySequences).values({ shardId: 'ember' }).onConflictDoNothing();
  await db.execute(
    sql`insert into world_timers (id, shard_id, kind, policy, remaining_ms, due_at, created_at) values (gen_random_uuid(), 'ember', 'decay', 'wall', 0, ${now}, ${now})`,
  );
  const report = await reconcileShard(db, 'ember', 2 * 3_600_000);
  expect(report.ok).toBe(true);
  expect(
    await db.select().from(partitionLeases).where(eq(partitionLeases.shardId, 'ember')),
  ).toEqual([]);
  const [seq] = await db
    .select()
    .from(shardEntitySequences)
    .where(eq(shardEntitySequences.shardId, 'ember'));
  expect(seq?.nextItem).toBeGreaterThanOrEqual(0x700099 + 1 + 4_096);
  const timers = await db.execute<{ due_at: Date }>(
    sql`select due_at from world_timers where shard_id = 'ember' and kind = 'decay'`,
  );
  expect(new Date(timers.rows[0]?.due_at as Date).getTime()).toBe(now.getTime() + 2 * 3_600_000);
  await db
    .insert(worldEntities)
    .values(item(0x60700040, 0x60799999, { placement: 'container', slot: null }));
  await expect(reconcileShard(db, 'ember', 0)).rejects.toMatchObject({
    code: 'PERSIST_RECONCILIATION_FAILED',
  });
  const [shard] = await db.select().from(shards).where(eq(shards.id, 'ember'));
  expect(shard?.manualStatus).toBe('maintenance');
});
