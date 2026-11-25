import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

let root: string;
const put = (file: string, text: string): void => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'duskmarch-'));
  for (const file of ['.dependency-cruiser.mjs', 'tsconfig.boundaries.json']) {
    cpSync(file, join(root, file));
  }
  put('package.json', '{"type":"module"}');
  for (const name of ['domain', 'rules', 'db', 'ui-kit', 'test-kit', 'config']) {
    put(`packages/${name}/src/index.ts`, 'export const x = 1;\n');
  }
  put('packages/config/src/env/server.ts', 'export const x = 1;\n');
  put('apps/api/src/index.ts', 'export const x = 1;\n');
});
afterEach(() => rmSync(root, { recursive: true }));

function cruise() {
  const bin = resolve('node_modules/.bin/depcruise');
  return spawnSync(bin, ['--config', '.dependency-cruiser.mjs', 'apps', 'packages'], {
    cwd: root,
    encoding: 'utf8',
  });
}

it('разрешает импорт вниз и test-kit в тестах', () => {
  put('packages/rules/src/index.ts', "export { x } from '@duskmarch/domain';\n");
  put('packages/rules/src/a.test.ts', "import '@duskmarch/test-kit';\n");
  put('apps/game-server/src/index.ts', "import '@duskmarch/rules';\nimport '@duskmarch/db';\n");
  const run = cruise();
  expect(run.stdout + run.stderr).toContain('no dependency violations');
  expect(run.status).toBe(0);
});

it.each([
  ['browser-no-server', 'apps/client/src/index.ts', '@duskmarch/db'],
  ['browser-no-server', 'apps/admin/src/index.ts', '@duskmarch/config/env/server'],
  ['browser-no-node', 'packages/ui-kit/src/index.ts', 'node:fs'],
  ['bot-and-asset-tool-no-db', 'apps/bot-client/src/index.ts', '@duskmarch/db'],
  ['server-no-browser-ui', 'apps/api/src/index.ts', '@duskmarch/ui-kit'],
  ['isomorphic-no-node', 'packages/domain/src/index.ts', 'node:fs'],
  ['test-kit-only-in-tests', 'apps/game-server/src/index.ts', '@duskmarch/test-kit'],
  ['no-import-from-app-api', 'packages/protocol/src/index.ts', '../../../apps/api/src/index.js'],
  ['layer-domain', 'packages/domain/src/index.ts', '@duskmarch/rules'],
])('%s: %s → %s', (rule, file, target) => {
  put(file, `import '${target}';\n`);
  const run = cruise();
  expect(run.status).not.toBe(0);
  expect(run.stdout).toContain(rule);
});

it('показывает цепочку цикла', () => {
  put('packages/domain/src/index.ts', "import '@duskmarch/rules';\nexport const x = 1;\n");
  put('packages/rules/src/index.ts', "import '@duskmarch/domain';\nexport const x = 1;\n");
  const run = cruise();
  expect(run.status).not.toBe(0);
  expect(run.stdout).toMatch(/no-circular[\s\S]*packages\/(domain|rules)/);
});
