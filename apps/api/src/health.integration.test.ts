import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { ApiEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { expect, it } from 'vitest';
import { createApp } from './create-app.js';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const config = loadServerConfig(ApiEnvSchema, { cwd });

async function ready(overrides: Partial<typeof config>) {
  const app = await createApp({ ...config, ...overrides });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  await new Promise((done) => setTimeout(done, 1_500));
  const start = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}/readyz`);
  const result = {
    status: response.status,
    body: (await response.json()) as unknown,
    ms: performance.now() - start,
  };
  await app.close();
  return result;
}

it('живой стенд: 200 за 500 мс', async () => {
  const result = await ready({});
  expect(result.status).toBe(200);
  expect(result.ms).toBeLessThanOrEqual(500);
});

it('недоступный NATS: 503', async () => {
  const result = await ready({ NATS_URL: 'nats://127.0.0.1:1' });
  expect(result.status).toBe(503);
  expect(result.body).toMatchObject({
    dependencies: { postgres: 'up', valkey: 'up', nats: 'down' },
  });
});
