import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it, vi } from 'vitest';
import { loadServerConfig, loadServerConfigOrExit } from './load.js';
import { BotClientEnvSchema } from './schemas/index.js';

const good = { TARGET_API_URL: 'http://a', TARGET_GAME_WS_URL: 'ws://a' };

it('возвращает типизированный неизменяемый объект', () => {
  const config = loadServerConfigOrExit(BotClientEnvSchema, { env: good, cwd: '/nonexistent' });
  const concurrency: number = config.BOT_CONCURRENCY;
  expect(concurrency).toBe(1);
  expect(Object.isFrozen(config)).toBe(true);
});

it('завершает процесс кодом 78 со всеми ошибками', () => {
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('exit');
  });
  const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  expect(() => loadServerConfigOrExit(BotClientEnvSchema, { env: {}, cwd: '/x' })).toThrow('exit');
  expect(exit).toHaveBeenCalledWith(78);
  expect(write.mock.calls.join()).toMatch(/TARGET_API_URL[\s\S]*TARGET_GAME_WS_URL/);
  vi.restoreAllMocks();
});

it('не скрывает значение несекретного поля, но скрывает пароль URI', () => {
  expect(() =>
    loadServerConfig(BotClientEnvSchema, { env: { ...good, BOT_CONCURRENCY: '9999' }, cwd: '/x' }),
  ).toThrow('"9999"');
});

it('дочерний процесс: код 78, обе ошибки, без секрета', () => {
  const dir = mkdtempSync(join(tmpdir(), 'duskmarch-load-'));
  try {
    const entry = join(dir, 'entry.mts');
    const url = (path: string) => pathToFileURL(join(process.cwd(), path)).href;
    writeFileSync(
      entry,
      `import { loadServerConfigOrExit, ApiEnvSchema } from '${url('src/env/server/index.ts')}';
loadServerConfigOrExit(ApiEnvSchema);
console.log('started');`,
    );
    const run = spawnSync(join(process.cwd(), 'node_modules/.bin/tsx'), [entry], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: process.env['PATH'],
        DATABASE_URL: 'mysql://u:s3cr3t@h/x',
        VALKEY_URL: 'redis://v',
        NATS_URL: 'nats://n',
        API_PORT: '99999',
      },
    });
    expect(run.status).toBe(78);
    expect(run.stderr).toMatch(/DATABASE_URL[\s\S]*API_PORT/);
    expect(run.stderr).not.toContain('s3cr3t');
    expect(run.stdout).not.toContain('started');
  } finally {
    rmSync(dir, { recursive: true });
  }
});
