import type { INestApplication } from '@nestjs/common';
import { ApiEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from './create-app.js';
import { HealthController } from './health.controller.js';

let app: INestApplication;
let base: string;
beforeAll(async () => {
  const env = {
    DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x',
    VALKEY_URL: 'redis://127.0.0.1:1',
    NATS_URL: 'nats://127.0.0.1:1',
  };
  app = await createApp(loadServerConfig(ApiEnvSchema, { env, cwd: '/nonexistent' }));
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(() => app.close());

it('без зависимостей healthz=200, readyz=503 с детализацией', async () => {
  expect((await fetch(`${base}/healthz`)).status).toBe(200);
  const ready = await fetch(`${base}/readyz`);
  expect(ready.status).toBe(503);
  expect(await ready.json()).toEqual({
    status: 'unavailable',
    dependencies: { postgres: 'down', valkey: 'down', nats: 'down' },
  });
});

it('readyz отвечает ok при живых зависимостях', async () => {
  const up = async () => undefined;
  const controller = new HealthController({ probes: { postgres: up, valkey: up, nats: up } });
  expect((await controller.readyz()).status).toBe('ok');
});
