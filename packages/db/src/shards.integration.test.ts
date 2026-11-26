import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DbEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  accounts,
  characters,
  createDbClient,
  migrateDatabase,
  seedDatabase,
  shards,
} from './index.js';

const cwd = fileURLToPath(new URL('../../..', import.meta.url));
const config = loadServerConfig(DbEnvSchema, { cwd });
const url = new URL(config.DATABASE_TEST_URL ?? '');
if (!url.pathname.endsWith('_test')) throw new Error('нужна база *_test');
const name = 'duskmarch_db_shards_test';
const admin = createDbClient(url.href);
url.pathname = `/${name}`;
const client = createDbClient(url.href);

beforeAll(async () => {
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.db.execute(sql.raw(`create database ${name}`));
  await migrateDatabase(client.db);
  await seedDatabase(client.db);
  await seedDatabase(client.db);
});
afterAll(async () => {
  await client.close();
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.close();
});

it('seed создаёт шарды разработки', async () => {
  const rows = await client.db.select().from(shards).orderBy(shards.sortOrder);
  expect(rows.map((r) => [r.id, r.preset])).toEqual([
    ['local-dev', 'proving'],
    ['ember', 'standard'],
  ]);
});

it('имя и слот уникальны среди неудалённых героев', async () => {
  const accountId = randomUUID();
  const now = new Date();
  await client.db.insert(accounts).values({
    id: accountId,
    email: `${accountId}@example.com`,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  const hero = (over: Partial<typeof characters.$inferInsert>) => ({
    id: randomUUID(),
    shardId: 'ember',
    accountId,
    entityId: Math.floor(Math.random() * 1e9),
    slot: 0,
    name: 'Ясна',
    nameKey: 'ясна',
    status: 'active',
    stats: {},
    appearance: {},
    startCity: 'lad',
    realm: 'dawn',
    x: 1,
    y: 1,
    h: 0,
    starterLoadout: [],
    createdAt: now,
    ...over,
  });
  await client.db.insert(characters).values(hero({}));
  await expect(client.db.insert(characters).values(hero({ slot: 1 }))).rejects.toThrow();
  await expect(
    client.db.insert(characters).values(hero({ name: 'Ива', nameKey: 'ива' })),
  ).rejects.toThrow();
  await client.db.insert(characters).values(hero({ shardId: 'local-dev' }));
  await client.db.insert(characters).values(hero({ status: 'deleted' }));
});
