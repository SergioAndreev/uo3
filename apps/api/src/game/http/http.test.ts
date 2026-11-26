import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { ApiEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../create-app.js';
import { PASSWORD } from '../../identity/testing/harness.test-helper.js';
import { APPEARANCE, gameHarness } from '../game-harness.test-helper.js';

let app: INestApplication;
let base: string;
let g: Awaited<ReturnType<typeof gameHarness>>;

beforeAll(async () => {
  g = await gameHarness();
  const env = {
    DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x',
    VALKEY_URL: 'redis://127.0.0.1:1',
    NATS_URL: 'nats://127.0.0.1:1',
  };
  app = await createApp(
    loadServerConfig(ApiEnvSchema, { env, cwd: '/nonexistent' }),
    { services: g.h, secureCookies: false },
    g.game,
  );
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(() => app.close());

async function call(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body:
      text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : undefined,
  };
}

const token = async (email: string) => {
  await g.h.activeAccount(email);
  return (await g.h.login(email, PASSWORD)).accessToken;
};

describe('HTTP шардов и героев', () => {
  it('каталог: список, ETag/304, карточка, протокол, 404', async () => {
    const list = await call('GET', '/api/v1/shards');
    expect(list.status).toBe(200);
    expect(list.body.map((s: { id: string }) => s.id)).toEqual(['local-dev', 'ember']);
    const etag = list.headers.get('etag') ?? '';
    expect(
      (await call('GET', '/api/v1/shards', { headers: { 'if-none-match': etag } })).status,
    ).toBe(304);
    const card = await call('GET', '/api/v1/shards/ember', {
      headers: { 'x-duskmarch-protocol': '1.0.0' },
    });
    expect(card.body).toMatchObject({ id: 'ember', compatible: true });
    expect(
      await call('GET', '/api/v1/shards', { headers: { 'x-duskmarch-protocol': 'latest' } }),
    ).toMatchObject({ status: 400, body: { error: { code: 'SHARD_PROTOCOL_HEADER_INVALID' } } });
    expect((await call('GET', '/api/v1/shards/nope')).status).toBe(404);
    expect((await call('GET', '/api/v1/shards', { token: 'garbage' })).status).toBe(401);
    expect((await call('GET', '/api/v1/shards/ember/creation-options')).body).toMatchObject({
      creationOpen: true,
    });
  });

  it('герой: проверка имени, создание с Idempotency-Key, список, билет, переименование, удаление', async () => {
    const t = await token('web-hero@example.com');
    expect(
      (
        await call('POST', '/api/v1/shards/ember/names/validate', {
          token: t,
          body: { name: 'ясна' },
        })
      ).body,
    ).toEqual({ valid: true, normalized: 'Ясна', violations: [] });
    const body = {
      name: 'Ясна',
      background: 'ranger',
      appearance: APPEARANCE,
      startCity: 'kremnev',
    };
    const created = await call('POST', '/api/v1/shards/ember/characters', {
      token: t,
      body,
      headers: { 'idempotency-key': 'k1' },
    });
    expect(created).toMatchObject({
      status: 201,
      body: { name: 'Ясна', slot: 0, status: 'active' },
    });
    expect(
      (
        await call('POST', '/api/v1/shards/ember/characters', {
          token: t,
          body,
          headers: { 'idempotency-key': 'k1' },
        })
      ).body,
    ).toEqual(created.body);
    expect(
      await call('POST', '/api/v1/shards/ember/characters', { token: t, body: { ...body, x: 5 } }),
    ).toMatchObject({ status: 400, body: { error: { code: 'CHAR_VALIDATION_FAILED' } } });
    const list = await call('GET', '/api/v1/shards/ember/characters', { token: t });
    expect(list.body.slots).toEqual({ used: 1, total: 5 });
    const id = created.body.id as string;
    const ticket = await call('POST', '/api/v1/shards/ember/tickets', {
      token: t,
      body: { characterId: id },
      headers: { 'x-duskmarch-protocol': '1.0.0' },
    });
    expect(ticket).toMatchObject({
      status: 201,
      body: { world: { roomId: 'ember-world' }, hub: { roomId: 'ember-hub' } },
    });
    expect(
      await call('POST', '/api/v1/shards/ember/tickets', {
        token: t,
        body: { characterId: id, purpose: 'realm_transfer' },
        headers: { 'x-duskmarch-protocol': '1.0.0' },
      }),
    ).toMatchObject({ status: 400, body: { error: { code: 'TICKET_PURPOSE_FORBIDDEN' } } });
    await g.store.updateShard('ember', { renamePolicy: 'free' });
    expect(
      (
        await call('POST', `/api/v1/shards/ember/characters/${id}/rename`, {
          token: t,
          body: { name: 'Ива' },
        })
      ).body,
    ).toMatchObject({ name: 'Ива' });
    const removed = await call('DELETE', `/api/v1/shards/ember/characters/${id}`, {
      token: t,
      body: { confirmName: 'Ива' },
    });
    expect(removed.body).toMatchObject({ status: 'pending_deletion' });
    expect(
      (await call('POST', `/api/v1/shards/ember/characters/${id}/restore`, { token: t })).body,
    ).toMatchObject({ status: 'active' });
  });

  it('персонал и администрирование', async () => {
    const owner = await token('web-player2@example.com');
    const hero = await call('POST', '/api/v1/shards/ember/characters', {
      token: owner,
      body: { name: 'Мила', background: 'envoy', appearance: APPEARANCE, startCity: 'solyar' },
    });
    const mod = await g.h.staffSession('web-mod@example.com', 'moderator');
    const cid = hero.body.id as string;
    expect(
      (
        await call('POST', `/api/v1/staff/characters/${cid}/lock`, {
          token: mod.session.accessToken,
          body: { reason: 'нарушение правил торговли' },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await call('POST', `/api/v1/staff/characters/${cid}/unlock`, {
          token: mod.session.accessToken,
          body: { reason: 'проверка завершена успешно' },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await call('POST', `/api/v1/staff/characters/${cid}/rename-required`, {
          token: mod.session.accessToken,
          body: { reason: 'имя нарушает правила шарда' },
        })
      ).status,
    ).toBe(204);
    expect(
      await call('POST', `/api/v1/staff/characters/${cid}/restore`, {
        token: mod.session.accessToken,
        body: { reason: 'ошибочное удаление игроком' },
      }),
    ).toMatchObject({ status: 403 });
    const admin = await g.h.staffSession('web-admin@example.com', 'administrator');
    const a = admin.session.accessToken;
    expect(
      await call('POST', '/api/v1/admin/shards', {
        token: a,
        body: { id: 'web-frost', name: 'Иней', region: 'eu', preset: 'standard' },
      }),
    ).toMatchObject({ status: 201, body: { id: 'web-frost' } });
    expect(
      await call('PATCH', '/api/v1/admin/shards/web-frost', {
        token: a,
        body: { characterSlots: 2 },
      }),
    ).toMatchObject({ status: 200, body: { characterSlots: 2 } });
    expect(
      await call('POST', '/api/v1/admin/shards/web-frost/status', {
        token: a,
        body: { status: 'maintenance' },
      }),
    ).toMatchObject({ status: 200, body: { status: 'maintenance' } });
    expect(
      await call('POST', '/api/v1/admin/shards', { token: a, body: { id: 'Bad' } }),
    ).toMatchObject({ status: 400, body: { error: { code: 'SHARD_VALIDATION_FAILED' } } });
  });
});
