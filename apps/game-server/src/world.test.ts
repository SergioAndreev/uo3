import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateSyntheticPack } from '@duskmarch/asset-formats';
import { GameServerEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { afterAll, expect, it } from 'vitest';
import { startGameHost } from './game-host.js';
import { loadWorld } from './world.js';

const root = mkdtempSync(join(tmpdir(), 'duskmarch-world-'));
afterAll(() => rmSync(root, { recursive: true }));
const write = (dir: string, files: Map<string, Uint8Array>) => {
  for (const [path, bytes] of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), bytes);
  }
};

it('синтетический план вне production', () => {
  const result = loadWorld({ NODE_ENV: 'development' });
  expect(result.ok && result.store.realm.key).toBe('proving');
  expect(result.ok && result.version).toMatch(/^[0-9a-f]{64}$/);
  expect(loadWorld({ NODE_ENV: 'production' })).toEqual({
    ok: false,
    errors: [expect.stringContaining('WORLD_PACK_DIR')],
  });
});

it('пакет из каталога и подмена чанка', () => {
  const pack = generateSyntheticPack('field', 7);
  const dir = join(root, 'field');
  write(dir, pack.files);
  const result = loadWorld({ NODE_ENV: 'production', WORLD_PACK_DIR: dir });
  expect(result.ok && result.store.realm.key).toBe('dawn');
  writeFileSync(join(dir, 'chunks/dawn/0_0.dmck'), new Uint8Array([1, 2, 3]));
  expect(loadWorld({ NODE_ENV: 'production', WORLD_PACK_DIR: dir })).toEqual({
    ok: false,
    errors: [expect.stringContaining('WORLD_CHUNK_HASH')],
  });
  expect(loadWorld({ NODE_ENV: 'development', WORLD_PACK_DIR: join(root, 'none') })).toMatchObject({
    ok: false,
  });
});

it('/readyz сообщает версию мира', async () => {
  const config = loadServerConfig(GameServerEnvSchema, {
    env: {
      DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x',
      VALKEY_URL: 'redis://127.0.0.1:1',
      NATS_URL: 'nats://127.0.0.1:1',
    },
    cwd: '/nonexistent',
  });
  const host = await startGameHost(
    { ...config, GAME_PORT: 0, GAME_HEALTH_PORT: 0 },
    { realm: 'proving', version: 'v1' },
  );
  try {
    const body = (await (
      await fetch(`http://127.0.0.1:${host.healthPort}/readyz`)
    ).json()) as Record<string, unknown>;
    expect(body['world']).toEqual({ realm: 'proving', version: 'v1' });
  } finally {
    await host.stop();
  }
});
