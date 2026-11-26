import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DbEnvSchema, GameServerEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { accounts, characters, createDbClient, migrateDatabase, seedDatabase } from '@duskmarch/db';
import { issueBundle, readShardLive } from '@duskmarch/db/live';
import { RUNTIME_OPCODES } from '@duskmarch/protocol';
import { Client } from 'colyseus.js';
import { eq, sql } from 'drizzle-orm';
import { Redis } from 'iovalkey';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startGameHost, type GameHost } from './game-host.js';
import { loadWorld } from './world.js';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const dbConfig = loadServerConfig(DbEnvSchema, { cwd: root });
const config = loadServerConfig(GameServerEnvSchema, {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
});
const url = new URL(dbConfig.DATABASE_TEST_URL ?? '');
if (!url.pathname.endsWith('_test')) throw new Error('нужна база *_test');
const name = 'duskmarch_game_runtime_test';
const admin = createDbClient(url.href);
url.pathname = `/${name}`;
const db = createDbClient(url.href);
const redis = new Redis(
  config.VALKEY_URL,
  config.VALKEY_PASSWORD ? { password: config.VALKEY_PASSWORD } : {},
);
let host: GameHost;
const accountId = randomUUID();
const characterId = randomUUID();

beforeAll(async () => {
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.db.execute(sql.raw(`create database ${name}`));
  await migrateDatabase(db.db);
  await seedDatabase(db.db);
  const now = new Date();
  await db.db.insert(accounts).values({
    id: accountId,
    email: `${accountId}@example.com`,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  await db.db.insert(characters).values({
    id: characterId,
    shardId: 'local-dev',
    accountId,
    entityId: 536_870_913,
    slot: 0,
    name: 'Испытатель',
    nameKey: 'испытатель',
    status: 'active',
    stats: { might: 30, finesse: 30, will: 30 },
    appearance: {},
    startCity: 'proving-camp',
    realm: 'proving',
    x: 9,
    y: 41,
    h: 0,
    starterLoadout: [],
    createdAt: now,
  });
  const world = loadWorld({ NODE_ENV: 'test' });
  if (!world.ok) throw new Error(world.errors.join());
  vi_silence();
  host = await startGameHost(
    {
      ...config,
      DATABASE_URL: url.href,
      SHARD_ID: 'local-dev',
      GAME_PORT: 0,
      GAME_HEALTH_PORT: 0,
      GAME_NODE_ID: `it-${process.pid}`,
    },
    world,
  );
}, 60_000);

afterAll(async () => {
  await host?.stop();
  redis.disconnect();
  await db.close();
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.close();
});

function vi_silence() {
  const log = console.log;
  console.log = (...args: unknown[]) => {
    if (!String(args[0]).includes('game-server:')) log(...args);
  };
}

const ticketPayload = (
  roomType: 'world' | 'hub',
  roomId: string,
  bundleId: string,
  now: number,
) => ({
  bundleId,
  shardId: 'local-dev',
  roomType,
  roomId,
  accountId,
  characterId,
  entityId: 536_870_913,
  name: 'Испытатель',
  accessLevel: 'player',
  effectiveLevel: 'player',
  realm: 'proving',
  x: 9,
  y: 41,
  h: 0,
  purpose: 'initial_login',
  takeover: false,
  issuedAt: now,
  expiresAt: now + 30_000,
});

it('билет P05 → вход в партицию и хаб → выход в безопасной зоне → сохранение', async () => {
  const node = host.node;
  expect(node?.state).toBe('READY');
  const roomId = 'local-dev-proving-0';
  await new Promise((resolve) => setTimeout(resolve, 300));
  const live = await readShardLive(redis, 'local-dev', Date.now());
  expect(live.partitions.map((p) => p.roomId)).toContain(roomId);
  expect(live.hub?.roomId).toBe('local-dev-hub');

  const now = Date.now();
  const bundleId = randomUUID();
  const world = {
    roomId,
    token: randomUUID().replace(/-/g, ''),
    payload: ticketPayload('world', roomId, bundleId, now),
    free: 10,
  };
  const hub = {
    roomId: 'local-dev-hub',
    token: randomUUID().replace(/-/g, ''),
    payload: ticketPayload('hub', 'local-dev-hub', bundleId, now),
    free: 10,
  };
  expect(
    await issueBundle(redis, {
      shardId: 'local-dev',
      accountId,
      bundleId,
      world,
      hub,
      ttlMs: 30_000,
      now,
    }),
  ).toBe('OK');

  const client = new Client(`ws://127.0.0.1:${host.gamePort}`);
  const room = await client.joinById(roomId, { ticket: world.token });
  const ready = await new Promise<unknown>((resolve) =>
    room.onMessage(RUNTIME_OPCODES['session:ready'], resolve),
  );
  expect(ready).toMatchObject({ realm: 'proving', x: 9, y: 41 });
  room.onMessage('*', () => undefined);

  const hubRoom = await client.joinById('local-dev-hub', { ticket: hub.token });
  const motd = await new Promise<unknown>((resolve) =>
    hubRoom.onMessage(RUNTIME_OPCODES['hub:motd'], resolve),
  );
  expect(motd).toMatchObject({ text: expect.any(String) });
  hubRoom.onMessage('*', () => undefined);

  await expect(client.joinById(roomId, { ticket: 'A'.repeat(40) })).rejects.toMatchObject({
    code: 4101,
  });

  const closed = new Promise<number>((resolve) => room.onLeave(resolve));
  room.send(RUNTIME_OPCODES['session:logout_request']);
  expect(await closed).toBe(4122);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const [saved] = await db.db.select().from(characters).where(eq(characters.id, characterId));
  expect(saved).toMatchObject({ x: 9, y: 41, health: 78, verve: 64, resonance: 64 });
  expect(saved?.lastPlayedAt).not.toBeNull();
  expect(await redis.get(`dm:shard:local-dev:session:${accountId}`)).toBeNull();
  await hubRoom.leave();
}, 60_000);
