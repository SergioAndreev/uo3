import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { ApiEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { defaultProfile } from '@duskmarch/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../create-app.js';
import { gameHarness } from '../game/game-harness.test-helper.js';
import { PASSWORD } from '../identity/testing/harness.test-helper.js';

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
  token: string,
  opts: { body?: unknown; headers?: Record<string, string>; raw?: string } = {},
) {
  const response = await fetch(
    `${base}/api/v1/account/client-profile${method === 'RESET' ? '/reset' : ''}`,
    {
      method: method === 'RESET' ? 'POST' : method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(opts.body !== undefined || opts.raw ? { 'content-type': 'application/json' } : {}),
        ...opts.headers,
      },
      ...(opts.raw
        ? { body: opts.raw }
        : opts.body !== undefined
          ? { body: JSON.stringify(opts.body) }
          : {}),
    },
  );
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : undefined,
  };
}

const login = async (email: string) => {
  await g.h.activeAccount(email);
  return (await g.h.login(email, PASSWORD)).accessToken;
};

describe('client/settings-profile: API профиля', () => {
  it('первый запрос — профиль по умолчанию, ревизия 1, ETag и 304', async () => {
    const t = await login('profile-a@example.com');
    const first = await call('GET', t);
    expect(first).toMatchObject({
      status: 200,
      body: { revision: 1, profile: { schemaVersion: 1 } },
    });
    expect(first.headers.get('etag')).toBe('"rev-1"');
    expect((await call('GET', t, { headers: { 'if-none-match': '"rev-1"' } })).status).toBe(304);
    expect((await call('GET', 'garbage')).status).toBe(401);
  });

  it('запись по ревизии, конфликт со снимком, правка и сброс категорий', async () => {
    const t = await login('profile-b@example.com');
    const profile = defaultProfile();
    profile.interface.uiScale = 1.25;
    const put = await call('PUT', t, { body: { expectedRevision: 1, profile } });
    expect(put).toMatchObject({
      status: 200,
      body: { revision: 2, profile: { interface: { uiScale: 1.25 } } },
    });
    expect(put.headers.get('etag')).toBe('"rev-2"');
    const stale = await call('PATCH', t, {
      body: { expectedRevision: 1, changes: { audio: { masterVolume: 10 } } },
    });
    expect(stale).toMatchObject({
      status: 409,
      body: { error: { code: 'PROFILE_REVISION_CONFLICT', details: { current: { revision: 2 } } } },
    });
    const patched = await call('PATCH', t, {
      body: { changes: { audio: { masterVolume: 10 } } },
      headers: { 'if-match': '"rev-2"' },
    });
    expect(patched.body).toMatchObject({
      revision: 3,
      profile: { audio: { masterVolume: 10 }, interface: { uiScale: 1.25 } },
    });
    const reset = await call('RESET', t, { body: { expectedRevision: 3, categories: ['audio'] } });
    expect(reset.body).toMatchObject({
      revision: 4,
      profile: { audio: { masterVolume: 80 }, interface: { uiScale: 1.25 } },
    });
    expect(
      (await call('PATCH', t, { body: { changes: { audio: { masterVolume: 1 } } } })).status,
    ).toBe(409);
  });

  it('вне границ — 422 с путями; больше 64 КиБ — 413; 31-я запись за минуту — 429', async () => {
    const t = await login('profile-c@example.com');
    const bad = defaultProfile() as unknown as Record<string, Record<string, unknown>>;
    (bad['graphics'] as Record<string, unknown>)['cameraZoom'] = 3.5;
    bad['injectedFlag'] = true as never;
    const r = await call('PUT', t, { body: { expectedRevision: 1, profile: bad } });
    expect(r).toMatchObject({
      status: 422,
      body: {
        error: {
          code: 'PROFILE_VALIDATION_FAILED',
          details: { fields: expect.arrayContaining(['/graphics/cameraZoom']) },
        },
      },
    });
    const huge = {
      expectedRevision: 1,
      profile: { ...defaultProfile(), junk: 'я'.repeat(40_000) },
    };
    expect((await call('PUT', t, { body: huge })).body.error.code).toBe(
      'PROFILE_PAYLOAD_TOO_LARGE',
    );
    let last = 0;
    let revision = 1;
    for (let i = 0; i < 31; i++) {
      const res = await call('PATCH', t, {
        body: { expectedRevision: revision, changes: { audio: { masterVolume: i % 100 } } },
      });
      last = res.status;
      if (res.status === 200) revision = res.body.revision;
      if (res.status === 429) expect(res.headers.get('retry-after')).toBeTruthy();
    }
    expect(last).toBe(429);
  });

  it('требование пакета ассетов шарда видно в каталоге', async () => {
    const admin = await g.h.staffSession('profile-admin@example.com', 'administrator');
    const res = await fetch(`${base}/api/v1/admin/shards`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${admin.session.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: 'frost',
        name: 'Иней',
        region: 'eu',
        preset: 'standard',
        assetPack: { id: 'pack.duskmarch-core', minVersion: '1.4.0' },
      }),
    });
    expect(res.status).toBe(201);
    const list = (await (await fetch(`${base}/api/v1/shards`)).json()) as {
      id: string;
      assetPack?: unknown;
    }[];
    expect(list.find((s) => s.id === 'frost')?.assetPack).toEqual({
      id: 'pack.duskmarch-core',
      minVersion: '1.4.0',
    });
    expect(list.find((s) => s.id === 'ember')?.assetPack).toBeUndefined();
  });
});
