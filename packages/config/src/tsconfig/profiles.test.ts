import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

function compile(profile: string, code: string, ext = 'ts'): string {
  const root = mkdtempSync(join(process.cwd(), '.fixture-'));
  try {
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    writeFileSync(join(root, `a.${ext}`), code);
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        extends: `../tsconfig/${profile}.json`,
        compilerOptions: { noEmit: true, composite: false },
        include: ['a.*'],
      }),
    );
    execFileSync(join(process.cwd(), 'node_modules/.bin/tsc'), ['-p', root], { encoding: 'utf8' });
    return '';
  } catch (error) {
    return (error as { stdout: string }).stdout;
  } finally {
    rmSync(root, { recursive: true });
  }
}

it.each([
  ['base', 'export const a: number = 1;'],
  ['isomorphic', 'export const a = new Map<string, number>();'],
  ['node', "import { join } from 'node:path';\nexport const a = join('a');"],
  ['nestjs', 'function D(t: new () => object) { return void t; }\n@D\nexport class A {}'],
  ['react', 'export const a = document.title;'],
])('профиль %s компилирует корректный код', (profile, code) => {
  expect(compile(profile, code)).toBe('');
});

it.each([
  ['base', 'export function f(x) { return x; }', 'TS7006'],
  ['base', 'export const f = (x: number[]): number => x[0];', 'TS2322'],
  ['isomorphic', 'export const a = document;', 'TS2584'],
  ['isomorphic', "import 'node:fs';\nexport const a = process;", 'TS2'],
])('профиль %s отклоняет: %s', (profile, code, error) => {
  expect(compile(profile, code)).toContain(error);
});
