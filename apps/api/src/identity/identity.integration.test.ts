import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { ApiEnvSchema, DbEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { createDbClient, migrateDatabase } from '@duskmarch/db';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createApp } from '../create-app.js';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const dbConfig = loadServerConfig(DbEnvSchema, { cwd: root });
const apiConfig = loadServerConfig(ApiEnvSchema, {
  cwd: fileURLToPath(new URL('../..', import.meta.url)),
});
const url = new URL(dbConfig.DATABASE_TEST_URL ?? '');
if (!url.pathname.endsWith('_test')) throw new Error('нужна база *_test');
const name = 'duskmarch_api_http_test';
const admin = createDbClient(url.href);
url.pathname = `/${name}`;

const ORIGIN = 'http://localhost:5273';
const PASSWORD = 'интеграционный пароль 2026';
const logs: string[] = [];
let app: INestApplication;
let base: string;
let nc: NatsConnection;

beforeAll(async () => {
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.db.execute(sql.raw(`create database ${name}`));
  const client = createDbClient(url.href);
  await migrateDatabase(client.db);
  await client.close();
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => void logs.push(String(line)));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  app = await createApp({
    ...apiConfig,
    DATABASE_URL: url.href,
    IDENTITY_TRUSTED_ORIGINS: [ORIGIN],
    IDENTITY_ARGON2_MEMORY_KIB: 1024,
    IDENTITY_ARGON2_TIME_COST: 1,
    MAIL_TRANSPORT: 'log',
  });
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const natsUrl = new URL(apiConfig.NATS_URL);
  const pass = apiConfig.NATS_PASSWORD ?? decodeURIComponent(natsUrl.password);
  nc = await connect({
    servers: `${natsUrl.protocol}//${natsUrl.host}`,
    ...(natsUrl.username ? { user: decodeURIComponent(natsUrl.username) } : {}),
    ...(pass ? { pass } : {}),
  });
});

afterAll(async () => {
  await nc?.close();
  await app?.close();
  vi.restoreAllMocks();
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.close();
});

async function call(method: string, path: string, body?: unknown, token?: string, cookie?: string) {
  const headers: Record<string, string> = { origin: ORIGIN, 'user-agent': 'integration' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers['authorization'] = `Bearer ${token}`;
  if (cookie) headers['cookie'] = cookie;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : undefined,
    cookies: response.headers.getSetCookie(),
  };
}

/** Токен из письма, которое журнальный транспорт вывел в консоль. */
async function mailedToken(to: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    for (const line of [...logs].reverse()) {
      if (!line.includes('identity: письмо')) continue;
      const mail = JSON.parse(line) as { to: string; text: string };
      const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
      if (mail.to === to && token) return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`письмо для ${to} не пришло`);
}

it('полный цикл на PostgreSQL, Valkey и NATS', async () => {
  const docs = (await call('GET', '/api/v1/auth/documents')).body;
  const email = `int-${process.pid}@example.com`;
  expect(
    (
      await call('POST', '/api/v1/auth/register', {
        email,
        password: PASSWORD,
        tosAccepted: true,
        ...docs,
      })
    ).status,
  ).toBe(202);
  expect(
    (await call('POST', '/api/v1/auth/verify-email', { token: await mailedToken(email) })).status,
  ).toBe(200);

  const login = await call('POST', '/api/v1/auth/login', { email, password: PASSWORD });
  expect(login.body).toMatchObject({ status: 'authenticated' });
  const cookie = login.cookies.find((c) => c.startsWith('dm_refresh='))?.split(';')[0] ?? '';
  const refreshed = await call('POST', '/api/v1/auth/refresh', undefined, undefined, cookie);
  expect(refreshed.status).toBe(200);
  const reused = await call('POST', '/api/v1/auth/refresh', undefined, undefined, cookie);
  expect(reused.body).toMatchObject({ error: { code: 'AUTH_TOKEN_REUSE_DETECTED' } });

  const sub = nc.subscribe('identity.account.sessions_revoked');
  const again = await call('POST', '/api/v1/auth/login', { email, password: PASSWORD });
  const token = again.body.accessToken as string;
  expect((await call('POST', '/api/v1/auth/logout', undefined, token)).status).toBe(204);
  const timer = setTimeout(() => sub.unsubscribe(), 10_000);
  const received: unknown[] = [];
  for await (const message of sub) {
    const event = message.json<{ reason: string }>();
    received.push(event);
    if (event.reason === 'logout') sub.unsubscribe();
  }
  clearTimeout(timer);
  expect(received).toContainEqual(
    expect.objectContaining({ sessionIds: [again.body.sessionId], reason: 'logout' }),
  );
  expect((await call('GET', '/api/v1/account/sessions', undefined, token)).body).toMatchObject({
    error: { code: 'AUTH_SESSION_REVOKED' },
  });

  const events = await call(
    'GET',
    '/api/v1/account/security-events?limit=10',
    undefined,
    (await call('POST', '/api/v1/auth/login', { email, password: PASSWORD })).body.accessToken,
  );
  expect(events.body.items.map((e: { type: string }) => e.type)).toEqual(
    expect.arrayContaining(['login', 'refresh_reuse', 'session_revoked']),
  );
});
