import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { refuseReason } from './env-reset.js';

const dev = 'postgresql://u:p@127.0.0.1:5432/duskmarch_dev';
const test = 'postgresql://u:p@localhost:5432/duskmarch_test';

it('разрешает только подтверждённый сброс локальных баз', () => {
  expect(refuseReason([dev, test], true)).toBeUndefined();
  expect(refuseReason([dev, test], false)).toContain('--yes');
});

it.each([
  ['postgresql://u:p@prod-db.example.com:5432/duskmarch', 'нелокальной'],
  ['postgresql://u:p@localhost.evil.com/duskmarch_dev', 'нелокальной'],
  ['postgresql://u:p@localhost/duskmarch_dev?host=prod', 'нелокальной'],
  ['postgresql://u:p@localhost/other', 'разрешённых'],
  [undefined, 'заданы'],
])('отказывает для %s', (url, reason) => {
  expect(refuseReason([url, test], true)).toContain(reason);
});

it('CLI прерывается с ненулевым кодом', () => {
  const run = spawnSync('node_modules/.bin/tsx', ['scripts/env-reset.ts', '--yes'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql://u:p@prod-db.example.com:5432/duskmarch',
    },
  });
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('prod-db.example.com');
  expect(run.stdout).toBe('');
});
