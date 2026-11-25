import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { checkWorkspaceManifests } from './check-workspace-manifests.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'duskmarch-'));
  cpSync('package.json', join(root, 'package.json'));
  for (const dir of ['apps', 'packages']) {
    cpSync(dir, join(root, dir), {
      recursive: true,
      filter: (path) => !/node_modules|dist|coverage|reports|\.turbo|\/src|fixture/.test(path),
    });
  }
});
afterEach(() => rmSync(root, { recursive: true }));

function patch(module: string, change: Record<string, unknown>): void {
  const file = join(root, module, 'package.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), ...change }));
}

it('принимает чистое дерево', () => expect(checkWorkspaceManifests(root)).toEqual([]));

it.each([
  ['packages/rules', { dependencies: { '@duskmarch/test-kit': 'workspace:*' } }, 'devDependencies'],
  ['packages/domain', { dependencies: { lodash: '4.0.0' } }, 'lodash'],
  ['packages/rules', { dependencies: { '@duskmarch/domain': '1.0.0' } }, 'workspace:*'],
  ['apps/api', { name: 'api' }, 'имя'],
  ['apps/api', { type: 'commonjs' }, 'type: module'],
])('отклоняет %s %o', (module, change, message) => {
  patch(module, change);
  expect(checkWorkspaceManifests(root).join('\n')).toContain(message);
});

it('замечает отсутствующий модуль и tsconfig', () => {
  rmSync(join(root, 'apps/admin'), { recursive: true });
  rmSync(join(root, 'packages/db/tsconfig.json'));
  const errors = checkWorkspaceManifests(root).join('\n');
  expect(errors).toContain('apps/admin: нет package.json');
  expect(errors).toContain('packages/db: нет tsconfig.json');
});

it('требует белый список lifecycle-скриптов', () => {
  patch('.', { pnpm: {} });
  expect(checkWorkspaceManifests(root).join()).toContain('onlyBuiltDependencies');
});
