import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import { pingHealth, runCli } from './cli.js';

it('--version и справка', async () => {
  const log = vi.fn();
  expect(await runCli(['--version'], log)).toBe(0);
  expect(log).toHaveBeenLastCalledWith(expect.stringContaining('bot-client 0.0.0'));
  expect(await runCli([], log)).toBe(1);
});

it('ping-health различает живой и недоступный API', async () => {
  const server = createServer((_, response) => response.end('{}'));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubEnv('TARGET_API_URL', url);
  vi.stubEnv('TARGET_GAME_WS_URL', 'ws://127.0.0.1:1');
  expect(await runCli(['ping-health'], vi.fn())).toBe(0);
  server.close();
  server.closeAllConnections();
  expect(await pingHealth('http://127.0.0.1:1')).toBe(false);
});

it('невалидное окружение завершается кодом 78', () => {
  const run = spawnSync(
    resolve('node_modules/.bin/tsx'),
    [resolve('src/index.ts'), 'ping-health'],
    {
      cwd: '/',
      encoding: 'utf8',
      env: { PATH: process.env['PATH'], LOG_LEVEL: 'loud' },
    },
  );
  expect(run.status).toBe(78);
  expect(run.stderr).toContain('LOG_LEVEL');
});
