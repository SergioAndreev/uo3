import { fileURLToPath } from 'node:url';
import { GameServerEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { expect, it } from 'vitest';
import { startGameHost } from './game-host.js';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const config = loadServerConfig(GameServerEnvSchema, { cwd });

async function ready(overrides: Partial<typeof config>) {
  const host = await startGameHost({ ...config, GAME_PORT: 0, GAME_HEALTH_PORT: 0, ...overrides });
  await new Promise((done) => setTimeout(done, 1_500));
  const start = performance.now();
  const response = await fetch(`http://127.0.0.1:${host.healthPort}/readyz`);
  const result = {
    status: response.status,
    body: (await response.json()) as unknown,
    ms: performance.now() - start,
  };
  await host.stop();
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
