import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'duskmarch-'));
  for (const f of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc']) {
    cpSync(f, join(root, f));
  }
  for (const dir of ['apps', 'packages']) {
    cpSync(dir, join(root, dir), {
      recursive: true,
      filter: (path) => !/node_modules|dist|coverage|reports|\.turbo|\/src|fixture/.test(path),
    });
  }
});
afterEach(() => rmSync(root, { recursive: true }));

const install = () =>
  spawnSync('pnpm', ['install', '--frozen-lockfile', '--lockfile-only'], {
    cwd: root,
    encoding: 'utf8',
  });

it('frozen-lockfile принимает согласованное дерево и не меняет lockfile', () => {
  const before = readFileSync(join(root, 'pnpm-lock.yaml'));
  expect(install().status).toBe(0);
  expect(readFileSync(join(root, 'pnpm-lock.yaml')).equals(before)).toBe(true);
});

it('frozen-lockfile отклоняет расхождение манифеста', () => {
  const file = join(root, 'packages/ui-kit/package.json');
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace('"react": "19.1.10"', '"react": "19.0.0"'),
  );
  const run = install();
  expect(run.status).not.toBe(0);
  expect(run.stdout + run.stderr).toContain('ERR_PNPM_OUTDATED_LOCKFILE');
});
