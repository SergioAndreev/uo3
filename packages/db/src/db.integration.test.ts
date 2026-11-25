import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DbEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDbClient, migrateDatabase, platformEnvMetadata, seedDatabase } from './index.js';

const cwd = fileURLToPath(new URL('../../..', import.meta.url));
const config = loadServerConfig(DbEnvSchema, { cwd });
const testUrl = config.DATABASE_TEST_URL ?? '';
if (!new URL(testUrl).pathname.endsWith('_test')) throw new Error('нужна база *_test');

const test = createDbClient(testUrl);
const dev = createDbClient(config.DATABASE_URL);
const PROBE = `probe.${process.pid}`;

beforeAll(async () => {
  await test.db.execute(sql`drop schema public cascade`);
  await test.db.execute(sql`create schema public`);
  await test.db.execute(sql`drop schema if exists drizzle cascade`);
  await migrateDatabase(dev.db);
  await dev.db
    .insert(platformEnvMetadata)
    .values({ key: PROBE, value: 1, description: 'контрольная запись' });
});
afterAll(async () => {
  await dev.db.delete(platformEnvMetadata).where(eq(platformEnvMetadata.key, PROBE));
  await Promise.all([dev.close(), test.close()]);
});

it('миграции и seed идемпотентны, dev не затронута', async () => {
  const rows = () => test.db.select().from(platformEnvMetadata).orderBy(platformEnvMetadata.key);
  await migrateDatabase(test.db);
  await migrateDatabase(test.db);
  await seedDatabase(test.db);
  const first = await rows();
  expect(first).toHaveLength(3);
  await seedDatabase(test.db);
  expect(await rows()).toEqual(first);
  const probe = await dev.db
    .select()
    .from(platformEnvMetadata)
    .where(eq(platformEnvMetadata.key, PROBE));
  expect(probe).toHaveLength(1);
});

it('CLI-команды завершаются успешно повторно', () => {
  for (const command of ['migrate', 'seed', 'migrate', 'seed']) {
    execFileSync('node_modules/.bin/tsx', [`src/cli/${command}.ts`], {
      env: { ...process.env, DATABASE_URL: testUrl },
    });
  }
});
