import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateSyntheticPack } from '@duskmarch/asset-formats';
import { afterAll, expect, it } from 'vitest';
import { createHealthServer } from './health-server.js';
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

it('/readyz и пробы P06 сообщают мир и состояние узла', async () => {
  const up = async () => true;
  const node = {
    state: 'STARTING',
    startedReady: false,
    onlineCount: 0,
    scheduler: { tickP99Ms: 3, droppedMs: 0, errors: 0, wheel: { size: 2 } },
  };
  const server = createHealthServer(
    { probes: { postgres: up, valkey: up, nats: up } } as never,
    { realm: 'proving', version: 'v1' },
    () => node as never,
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const starting = await fetch(`${base}/health/ready`);
    expect(starting.status).toBe(503);
    expect(await starting.json()).toMatchObject({
      world: { realm: 'proving', version: 'v1' },
      node: 'STARTING',
    });
    expect((await fetch(`${base}/health/startup`)).status).toBe(503);
    expect((await fetch(`${base}/health/live`)).status).toBe(200);
    Object.assign(node, { state: 'READY', startedReady: true });
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
    expect((await fetch(`${base}/health/startup`)).status).toBe(200);
    expect(await (await fetch(`${base}/metrics`)).text()).toContain('duskmarch_tick_p99_ms 3');
    Object.assign(node, { state: 'DRAINING' });
    expect((await fetch(`${base}/health/ready`)).status).toBe(503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
