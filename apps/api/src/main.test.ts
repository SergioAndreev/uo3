import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('невалидное окружение: код 78, все ошибки, без секрета', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'duskmarch-'));
  try {
    const run = spawnSync(resolve('node_modules/.bin/tsx'), [resolve('src/main.ts')], {
      cwd,
      encoding: 'utf8',
      env: { PATH: process.env['PATH'], DATABASE_URL: 'mysql://u:s3cr3t@h/x', API_PORT: '99999' },
    });
    expect(run.status).toBe(78);
    expect(run.stderr).toMatch(/DATABASE_URL[\s\S]*NATS_URL[\s\S]*API_PORT/);
    expect(run.stderr + run.stdout).not.toContain('s3cr3t');
  } finally {
    rmSync(cwd, { recursive: true });
  }
});
