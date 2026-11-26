import { fileURLToPath } from 'node:url';
import { ApiEnvSchema, DbEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { createDbClient, migrateDatabase } from '@duskmarch/db';
import { connect } from '@nats-io/transport-node';
import { sql } from 'drizzle-orm';
import { Redis } from 'iovalkey';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { keyValueContract, storeContract } from '../testing/contracts.test-helper.js';
import { DrizzleIdentityStore } from './drizzle-store.js';
import { NatsEventPublisher } from './nats-events.js';
import { ValkeyKeyValue } from './valkey-kv.js';

const cwd = fileURLToPath(new URL('../../../../..', import.meta.url));
const db = loadServerConfig(DbEnvSchema, { cwd });
const api = loadServerConfig(ApiEnvSchema, {
  cwd: fileURLToPath(new URL('../../..', import.meta.url)),
});
const url = new URL(db.DATABASE_TEST_URL ?? '');
if (!url.pathname.endsWith('_test')) throw new Error('нужна база *_test');
const name = 'duskmarch_api_identity_test';
const admin = createDbClient(url.href);
url.pathname = `/${name}`;
const client = createDbClient(url.href);
const redis = new Redis(api.VALKEY_URL, {
  ...(api.VALKEY_PASSWORD ? { password: api.VALKEY_PASSWORD } : {}),
  keyPrefix: 'test:identity:',
});

beforeAll(async () => {
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.db.execute(sql.raw(`create database ${name}`));
  await migrateDatabase(client.db);
});
afterAll(async () => {
  await client.close();
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.close();
  redis.disconnect();
});

storeContract('PostgreSQL', async () => new DrizzleIdentityStore(client.db));
keyValueContract('Valkey', async () => ({
  kv: new ValkeyKeyValue(redis),
  advance: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}));

it('NATS: публикация доходит до подписчика; без подключения — ошибка', async () => {
  const natsUrl = new URL(api.NATS_URL);
  const password = api.NATS_PASSWORD ?? decodeURIComponent(natsUrl.password);
  const nc = await connect({
    servers: `${natsUrl.protocol}//${natsUrl.host}`,
    ...(natsUrl.username ? { user: decodeURIComponent(natsUrl.username) } : {}),
    ...(password ? { pass: password } : {}),
  });
  const subject = `identity.test.${process.pid}`;
  const sub = nc.subscribe(subject, { max: 1 });
  await new NatsEventPublisher(() => nc).publish(subject, { ok: 1 });
  for await (const message of sub) expect(message.json()).toEqual({ ok: 1 });
  await nc.close();
  await expect(new NatsEventPublisher(() => undefined).publish(subject, {})).rejects.toThrow();
});
