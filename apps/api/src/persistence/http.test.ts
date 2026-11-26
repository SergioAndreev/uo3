import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { ApiEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import type { LedgerRow } from '@duskmarch/db/world';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../create-app.js';
import type { IdentityServices } from '../identity/core/index.js';
import { gameHarness } from '../game/game-harness.test-helper.js';
import { PASSWORD } from '../identity/testing/harness.test-helper.js';
import { MemoryLedgerStore, PersistenceAdmin } from './index.js';

let app: INestApplication;
let base: string;
let g: Awaited<ReturnType<typeof gameHarness>>;
const ledger = new MemoryLedgerStore();
let flushes = 0;
let clock = 1_000_000;

const event = (seq: number, itemId: number, extra: Partial<LedgerRow> = {}): LedgerRow => ({
  shardId: 'ember',
  ledgerSeq: seq,
  createdAt: new Date(Date.UTC(2026, 10, 26, 10, seq)),
  txId: '00000000-0000-4000-8000-00000000000' + (seq % 10),
  txType: 'TRADE_EXCHANGE',
  eventKind: 'TRANSFER',
  itemId,
  sourceItemId: null,
  amountDelta: 0,
  fromOwnerId: null,
  toOwnerId: null,
  fromParentId: null,
  toParentId: null,
  actorAccountId: null,
  actorAccessLevel: null,
  characterId: '7d0e2a8e-1c7e-4c49-9a5f-2b4a1f0e9d11',
  realm: null,
  x: null,
  y: null,
  h: null,
  reasonCode: null,
  details: {},
  ...extra,
});

beforeAll(async () => {
  g = await gameHarness();
  ledger.rows.push(
    event(1, 0x60005000, { eventKind: 'CREATE', amountDelta: 1_000 }),
    event(2, 0x60005000, { eventKind: 'SPLIT', amountDelta: -300 }),
    event(3, 0x60005001, { eventKind: 'CREATE', amountDelta: 300, sourceItemId: 0x60005000 }),
    event(4, 0x60005001, { eventKind: 'TRANSFER' }),
    event(5, 0x60009999, { characterId: null }),
  );
  const admin = new PersistenceAdmin(
    g.h as unknown as IdentityServices,
    ledger,
    {
      request: async () => ({
        flushId: `f-${++flushes}`,
        entitiesSaved: 420,
        durationMs: 12,
        checkpointSeq: 7,
      }),
    },
    () => clock,
  );
  const env = {
    DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x',
    VALKEY_URL: 'redis://127.0.0.1:1',
    NATS_URL: 'nats://127.0.0.1:1',
  };
  app = await createApp(
    loadServerConfig(ApiEnvSchema, { env, cwd: '/nonexistent' }),
    { services: g.h, secureCookies: false },
    g.game,
    admin,
  );
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(() => app.close());

async function call(method: string, path: string, token?: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : undefined,
  };
}

const P = '/api/v1/admin/shards/ember/persistence';

describe('persistence: API администрирования', () => {
  it('журнал: история, цепочка происхождения, по герою с курсором; игроку — 403', async () => {
    const gm = await g.h.staffSession('gm@example.com', 'game-master');
    const history = await call('GET', `${P}/ledger/items/${0x60005001}`, gm.session.accessToken);
    expect(history.status).toBe(200);
    expect(history.body.events.map((e: LedgerRow) => e.ledgerSeq)).toEqual([3, 4]);
    const lineage = await call(
      'GET',
      `${P}/ledger/items/${0x60005001}/lineage`,
      gm.session.accessToken,
    );
    expect(lineage.body.items).toEqual([0x60005000, 0x60005001]);
    expect(lineage.body.events.map((e: LedgerRow) => e.ledgerSeq)).toEqual([1, 2, 3, 4]);
    const page1 = await call(
      'GET',
      `${P}/ledger?characterId=7d0e2a8e-1c7e-4c49-9a5f-2b4a1f0e9d11&limit=3`,
      gm.session.accessToken,
    );
    expect(page1.body.events).toHaveLength(3);
    expect(page1.body.cursor).toBe('3');
    const page2 = await call(
      'GET',
      `${P}/ledger?characterId=7d0e2a8e-1c7e-4c49-9a5f-2b4a1f0e9d11&limit=3&cursor=3`,
      gm.session.accessToken,
    );
    expect(page2.body).toMatchObject({
      cursor: null,
      events: [expect.objectContaining({ ledgerSeq: 4 })],
    });
    expect((await call('GET', `${P}/ledger?limit=1000`, gm.session.accessToken)).status).toBe(400);
    expect((await call('GET', `${P}/ledger/items/abc`, gm.session.accessToken)).status).toBe(400);
    await g.h.activeAccount('player@example.com');
    const player = (await g.h.login('player@example.com', PASSWORD)).accessToken;
    const denied = await call('GET', `${P}/ledger/items/1`, player);
    expect(denied).toMatchObject({
      status: 403,
      body: { error: { code: 'RBAC_INSUFFICIENT_PERMISSION' } },
    });
  });

  it('ручное сохранение: администратор — 200; ведущий — 403; повтор через 2 с — 429; force — проходит', async () => {
    const admin = await g.h.staffSession('admin@example.com', 'administrator');
    const gm = await g.h.staffSession('gm2@example.com', 'game-master');
    const ok = await call('POST', `${P}/flush`, admin.session.accessToken, {});
    expect(ok).toMatchObject({
      status: 200,
      body: { flushId: 'f-1', entitiesSaved: 420, checkpointSeq: 7 },
    });
    expect((await call('POST', `${P}/flush`, gm.session.accessToken, {})).status).toBe(403);
    clock += 2_000;
    const soon = await call('POST', `${P}/flush`, admin.session.accessToken, {});
    expect(soon).toMatchObject({
      status: 429,
      body: { error: { code: 'PERSIST_FLUSH_COOLDOWN_ACTIVE', details: { retryAfterMs: 3_000 } } },
    });
    expect(soon.headers.get('retry-after')).toBe('3');
    expect(
      (await call('POST', `${P}/flush`, admin.session.accessToken, { force: true })).body.flushId,
    ).toBe('f-2');
  });

  it('точка восстановления: администратор — 201 с LSN; повтор имени — 409; без обоснования — 400', async () => {
    const admin = await g.h.staffSession('admin3@example.com', 'administrator');
    const t = admin.session.accessToken;
    const body = {
      name: 'pre-p13-release-2026-12-01',
      reason: 'Контрольная точка перед миграцией P13',
    };
    const created = await call('POST', `${P}/restore-points`, t, body);
    expect(created).toMatchObject({
      status: 201,
      body: { name: body.name, lsn: expect.stringMatching(/^0\//), checkpointSeq: 7 },
    });
    expect(await call('POST', `${P}/restore-points`, t, body)).toMatchObject({
      status: 409,
      body: { error: { code: 'PERSIST_RESTORE_POINT_EXISTS' } },
    });
    expect(
      (await call('POST', `${P}/restore-points`, t, { name: 'x', reason: 'мало' })).status,
    ).toBe(400);
    const gm = await g.h.staffSession('gm3@example.com', 'game-master');
    expect(
      (
        await call('POST', `${P}/restore-points`, gm.session.accessToken, {
          ...body,
          name: 'other-point',
        })
      ).status,
    ).toBe(403);
  });
});
