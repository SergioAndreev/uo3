import { PROTOCOL_VERSION } from '@duskmarch/protocol';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { ApiEnvSchema, DbEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { createDbClient, migrateDatabase, seedDatabase } from '@duskmarch/db';
import { publishHeartbeat, publishHub, publishPartition, redeemTicket } from '@duskmarch/db/live';
import { sql } from 'drizzle-orm';
import { Redis } from 'iovalkey';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createApp } from '../create-app.js';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const dbConfig = loadServerConfig(DbEnvSchema, { cwd: root });
const apiConfig = loadServerConfig(ApiEnvSchema, {
  cwd: fileURLToPath(new URL('../..', import.meta.url)),
});
const url = new URL(dbConfig.DATABASE_TEST_URL ?? '');
if (!url.pathname.endsWith('_test')) throw new Error('нужна база *_test');
const name = 'duskmarch_api_game_http_test';
const admin = createDbClient(url.href);
url.pathname = `/${name}`;
const ORIGIN = 'http://localhost:5273';
const PASSWORD = 'интеграционный пароль 2026';
const logs: string[] = [];
const redis = new Redis(
  apiConfig.VALKEY_URL,
  apiConfig.VALKEY_PASSWORD ? { password: apiConfig.VALKEY_PASSWORD } : {},
);
let app: INestApplication;
let base: string;

beforeAll(async () => {
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.db.execute(sql.raw(`create database ${name}`));
  const client = createDbClient(url.href);
  await migrateDatabase(client.db);
  await seedDatabase(client.db);
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
});

afterAll(async () => {
  await app?.close();
  redis.disconnect();
  vi.restoreAllMocks();
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.close();
});

async function call(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = {
    origin: ORIGIN,
    'x-duskmarch-protocol': PROTOCOL_VERSION,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers['authorization'] = `Bearer ${token}`;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

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
  throw new Error('письмо не пришло');
}

it('регистрация → герой → билет → погашение игровым сервером', async () => {
  const email = `hero-${process.pid}@example.com`;
  const docs = (await call('GET', '/api/v1/auth/documents')).body;
  await call('POST', '/api/v1/auth/register', {
    email,
    password: PASSWORD,
    tosAccepted: true,
    ...docs,
  });
  await call('POST', '/api/v1/auth/verify-email', { token: await mailedToken(email) });
  const token = (await call('POST', '/api/v1/auth/login', { email, password: PASSWORD })).body
    .accessToken as string;

  const shards = await call('GET', '/api/v1/shards');
  expect(shards.body.map((s: { id: string; status: string }) => [s.id, s.status])).toEqual([
    ['local-dev', 'offline'],
    ['ember', 'offline'],
  ]);
  const created = await call(
    'POST',
    '/api/v1/shards/local-dev/characters',
    {
      name: 'Испытатель',
      stats: { might: 30, finesse: 30, will: 30 },
      skills: [
        { skill: 'edge', tenths: 1000 },
        { skill: 'archery', tenths: 1000 },
      ],
      appearance: { build: 'lean', face: 0, hairStyle: 0, beard: 0, skinTint: 5, hairTint: 4 },
      startCity: 'proving-camp',
    },
    token,
  );
  expect(created).toMatchObject({ status: 201, body: { name: 'Испытатель', realm: 'proving' } });
  expect(
    (
      await call(
        'POST',
        '/api/v1/shards/local-dev/tickets',
        { characterId: created.body.id },
        token,
      )
    ).body,
  ).toMatchObject({ error: { code: 'SHARD_OFFLINE' } });

  const now = Date.now();
  await publishHeartbeat(redis, 'local-dev', {
    nodeId: 'it',
    onlineCount: 0,
    tickP99Ms: 5,
    draining: false,
    updatedAt: now,
  });
  await publishPartition(redis, 'local-dev', {
    partitionId: 'p',
    realm: 'proving',
    minX: 0,
    minY: 0,
    maxX: 63,
    maxY: 63,
    roomId: 'w-it',
    wsUrl: 'ws://127.0.0.1:2567',
    hardCapacity: 10,
    staffBuffer: 1,
    onlineCount: 0,
    draining: false,
    updatedAt: now,
  });
  await publishHub(redis, 'local-dev', {
    roomId: 'h-it',
    wsUrl: 'ws://127.0.0.1:2567',
    hardCapacity: 10,
    staffBuffer: 1,
    onlineCount: 0,
    draining: false,
    updatedAt: now,
  });
  const ticket = await call(
    'POST',
    '/api/v1/shards/local-dev/tickets',
    { characterId: created.body.id },
    token,
  );
  expect(ticket.status).toBe(201);
  const redeemed = await redeemTicket(
    redis,
    ticket.body.world.ticket,
    { shardId: 'local-dev', roomType: 'world', roomId: 'w-it' },
    Date.now(),
  );
  expect(redeemed).toMatchObject({
    ok: true,
    payload: { characterId: created.body.id, name: 'Испытатель', realm: 'proving', x: 32, y: 32 },
  });
  expect(
    (
      await redeemTicket(
        redis,
        ticket.body.world.ticket,
        { shardId: 'local-dev', roomType: 'world', roomId: 'w-it' },
        Date.now(),
      )
    ).ok,
  ).toBe(false);
});
