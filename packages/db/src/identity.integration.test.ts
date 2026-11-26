import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DbEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { accounts, createDbClient, migrateDatabase, securityEvents } from './index.js';

const cwd = fileURLToPath(new URL('../../..', import.meta.url));
const config = loadServerConfig(DbEnvSchema, { cwd });
const url = new URL(config.DATABASE_TEST_URL ?? '');
if (!url.pathname.endsWith('_test')) throw new Error('нужна база *_test');
// Собственная база: db.integration.test.ts пересоздаёт схему основной тестовой базы.
const name = 'duskmarch_db_identity_test';
const admin = createDbClient(url.href);
url.pathname = `/${name}`;
const client = createDbClient(url.href);

beforeAll(async () => {
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.db.execute(sql.raw(`create database ${name}`));
  await migrateDatabase(client.db);
});
afterAll(async () => {
  await client.close();
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.close();
});

const event = () => ({
  id: randomUUID(),
  accountId: null,
  type: 'login',
  outcome: 'failure',
  reasonCode: 'AUTH_INVALID_CREDENTIALS',
  ip: '203.0.113.10',
  userAgent: 'test',
  at: new Date(),
});

it('журнал событий только для добавления', async () => {
  const row = event();
  await client.db.insert(securityEvents).values(row);
  await expect(
    client.db
      .update(securityEvents)
      .set({ outcome: 'success' })
      .where(eq(securityEvents.id, row.id)),
  ).rejects.toThrow();
  await expect(
    client.db.delete(securityEvents).where(eq(securityEvents.id, row.id)),
  ).rejects.toThrow();
  await client.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('duskmarch.retention', 'on', true)`);
    await tx.delete(securityEvents).where(eq(securityEvents.id, row.id));
  });
  expect(
    await client.db.select().from(securityEvents).where(eq(securityEvents.id, row.id)),
  ).toEqual([]);
});

it('email уникален среди живых аккаунтов', async () => {
  const base = {
    email: 'hero@example.com',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await client.db.insert(accounts).values({ ...base, id: randomUUID(), status: 'expired' });
  await client.db.insert(accounts).values({ ...base, id: randomUUID() });
  await expect(client.db.insert(accounts).values({ ...base, id: randomUUID() })).rejects.toThrow();
});
