import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { browserPreset } from './browser.js';
import { nodePreset } from './node.js';

it('назначает пороги по слоям', () => {
  expect(nodePreset('core').test?.coverage).toMatchObject({
    thresholds: { lines: 85, branches: 80 },
  });
  expect(nodePreset().test?.coverage).toMatchObject({ thresholds: { lines: 70, branches: 65 } });
  expect(browserPreset().test?.environment).toBe('jsdom');
  expect(nodePreset().test?.coverage).toMatchObject({
    exclude: expect.arrayContaining(['**/dist/**', '**/*.d.ts', '**/*.test.{ts,tsx}']),
  });
});

it('прогон падает при покрытии ниже порога', () => {
  const root = mkdtempSync(join(process.cwd(), '.fixture-'));
  try {
    const put = (name: string, text: string) => writeFileSync(join(root, name), text);
    put('package.json', '{"type":"module"}');
    put(
      'a.ts',
      'export function a(x: number) {\n  if (x > 1) {\n    return 1;\n  }\n  return 2;\n}\nexport function b() {\n  return 3;\n}\n',
    );
    put('a.test.ts', "import { it } from 'vitest';\nimport './a.js';\nit('x', () => {});\n");
    const thresholds = JSON.stringify(nodePreset('core').test?.coverage);
    put(
      'vitest.config.ts',
      `const c = ${thresholds};\nexport default { test: { include: ['*.test.ts'], coverage: { ...c, reporter: ['text'], include: ['a.ts'] } } };\n`,
    );
    let output = '';
    try {
      execFileSync(join(process.cwd(), 'node_modules/.bin/vitest'), ['run', '--coverage'], {
        cwd: root,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (error) {
      const failed = error as { stdout: string; stderr: string };
      output = failed.stdout + failed.stderr;
    }
    expect(output).toMatch(/does not meet global threshold/);
  } finally {
    rmSync(root, { recursive: true });
  }
});
