import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bootstrap, findPortConflicts, type BootstrapDeps } from './bootstrap.js';
import { APP_DIRS, createMissingEnvFiles } from './lib/env-files.js';
import { dockerAvailable } from './lib/probes.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'duskmarch-'));
  cpSync('.env.example', join(root, '.env.example'));
  for (const app of APP_DIRS) {
    mkdirSync(join(root, 'apps', app), { recursive: true });
    cpSync(`apps/${app}/.env.example`, join(root, `apps/${app}/.env.example`));
  }
});
afterEach(() => rmSync(root, { recursive: true }));

it('создаёт файлы один раз и сохраняет правки', () => {
  const custom = readFileSync('.env.example', 'utf8').replace('PG_PORT=5432', 'PG_PORT=15432');
  writeFileSync(join(root, '.env'), custom);
  expect(createMissingEnvFiles(root)).toHaveLength(6);
  expect(readFileSync(join(root, 'apps/api/.env'), 'utf8')).toContain('127.0.0.1:15432/');
  writeFileSync(join(root, 'apps/api/.env'), 'LOG_LEVEL=debug');
  expect(createMissingEnvFiles(root)).toEqual([]);
  expect(readFileSync(join(root, 'apps/api/.env'), 'utf8')).toBe('LOG_LEVEL=debug');
  expect(readFileSync(join(root, '.env'), 'utf8')).toBe(custom);
});

const deps = () => ({
  docker: () => true,
  running: () => new Set(['postgres', 'valkey', 'nats']),
  run: vi.fn<BootstrapDeps['run']>(() => true),
  log: vi.fn<BootstrapDeps['log']>(),
});

it('выполняет шаги по порядку и останавливается на ошибке', async () => {
  const good = deps();
  expect(await bootstrap(root, good)).toBe(0);
  expect(good.run.mock.calls.map((call) => call[1].at(-1))).toEqual([
    '120',
    'db:migrate',
    'db:seed',
    'doctor',
  ]);
  const bad = { ...deps(), run: vi.fn(() => false) };
  expect(await bootstrap(root, bad)).toBe(1);
  expect(bad.run).toHaveBeenCalledOnce();
});

it('без Docker отказывает быстро и с инструкцией', async () => {
  const start = performance.now();
  expect(dockerAvailable(8_000, '/nonexistent/docker')).toBe(false);
  const offline = { ...deps(), docker: () => false };
  expect(await bootstrap(root, offline)).toBe(1);
  expect(offline.log.mock.calls.join()).toContain('Запустите Docker');
  expect(performance.now() - start).toBeLessThan(10_000);
});

it('называет занятый порт и переменную', async () => {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  const free = { VALKEY_PORT: 0, NATS_PORT: 0, NATS_MONITOR_PORT: 0 };
  const message = (await findPortConflicts({ PG_PORT: port, ...free }, new Set())).join();
  expect(message).toContain(String(port));
  expect(message).toContain('PG_PORT');
  expect(await findPortConflicts({ PG_PORT: port, ...free }, new Set(['postgres']))).toEqual([]);
  server.close();
});
