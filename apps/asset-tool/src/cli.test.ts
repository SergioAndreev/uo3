import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { expect, it, vi } from 'vitest';
import { runCli } from './cli.js';

it('--version и справка', async () => {
  const log = vi.fn();
  expect(await runCli(['--version'], log)).toBe(0);
  expect(log).toHaveBeenLastCalledWith(expect.stringContaining('asset-tool 0.0.0'));
  expect(await runCli([], log)).toBe(1);
});

it('check-env принимает значения по умолчанию', async () => {
  expect(await runCli(['check-env'], vi.fn())).toBe(0);
});

it('невалидное окружение завершается кодом 78', () => {
  const run = spawnSync(resolve('node_modules/.bin/tsx'), [resolve('src/index.ts'), 'check-env'], {
    cwd: '/',
    encoding: 'utf8',
    env: { PATH: process.env['PATH'], LOG_LEVEL: 'loud' },
  });
  expect(run.status).toBe(78);
  expect(run.stderr).toContain('LOG_LEVEL');
});
