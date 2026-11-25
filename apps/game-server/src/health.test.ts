import { GameServerEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { expect, it } from 'vitest';
import { startGameHost } from './game-host.js';

const down = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x',
  VALKEY_URL: 'redis://127.0.0.1:1',
  NATS_URL: 'nats://127.0.0.1:1',
};

it('без зависимостей healthz=200, readyz=503, остановка чистая', async () => {
  const config = loadServerConfig(GameServerEnvSchema, { env: down, cwd: '/nonexistent' });
  const host = await startGameHost({ ...config, GAME_PORT: 0, GAME_HEALTH_PORT: 0 });
  const base = `http://127.0.0.1:${host.healthPort}`;
  try {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/other`)).status).toBe(404);
    const ready = await fetch(`${base}/readyz`);
    expect(ready.status).toBe(503);
    expect(ready.headers.get('content-type')).toBe('application/json');
    expect(await ready.json()).toMatchObject({ dependencies: { nats: 'down' } });
  } finally {
    await host.stop();
  }
  await expect(fetch(`${base}/healthz`)).rejects.toThrow();
});
