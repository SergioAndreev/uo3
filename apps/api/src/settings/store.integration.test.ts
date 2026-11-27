import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DbEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { accounts, createDbClient, migrateDatabase } from '@duskmarch/db';
import { defaultProfile } from '@duskmarch/protocol';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DrizzleProfileStore } from './index.js';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const db = loadServerConfig(DbEnvSchema, { cwd: root });
const url = new URL(db.DATABASE_TEST_URL ?? '');
if (!url.pathname.endsWith('_test')) throw new Error('нужна база *_test');
const name = 'duskmarch_api_profiles_test';
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

it('профиль: первая запись — вставка, далее по ревизии; устаревшая ревизия — отказ', async () => {
  const id = randomUUID();
  const now = new Date();
  await client.db
    .insert(accounts)
    .values({ id, email: `${id}@example.com`, status: 'active', createdAt: now, updatedAt: now });
  const store = new DrizzleProfileStore(client.db);
  expect(await store.get(id)).toBeNull();
  const p = defaultProfile();
  const first = await store.save(id, 1, p, now);
  expect(first?.revision).toBe(2);
  expect(await store.save(id, 1, p, now)).toBeNull();
  p.audio.masterVolume = 5;
  const second = await store.save(id, 2, p, now);
  expect(second).toMatchObject({ revision: 3, profile: { audio: { masterVolume: 5 } } });
  expect(await store.save(id, 2, p, now)).toBeNull();
  expect((await store.get(id))?.revision).toBe(3);
});
