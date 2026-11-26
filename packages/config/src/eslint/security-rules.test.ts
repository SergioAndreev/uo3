import { ESLint } from 'eslint';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const eslint = new ESLint({ cwd: resolve('../..') });

it.each(['apps/client', 'apps/admin', 'packages/ui-kit'])(
  '%s запрещает динамическое исполнение',
  async (module) => {
    const code = "eval('1');\nnew Function('return 1');\nsetTimeout('x()', 1);\n";
    const [result] = await eslint.lintText(code, { filePath: `${module}/src/probe.ts` });
    const rules = result?.messages.map((message) => message.ruleId);
    expect(rules).toEqual(expect.arrayContaining(['no-eval', 'no-new-func', 'no-implied-eval']));
  },
);

it.each([
  ['Math.random()', 'no-restricted-properties'],
  ['Date.now()', 'no-restricted-properties'],
  ['new Date()', 'no-restricted-syntax'],
  ['performance.now()', 'no-restricted-globals'],
  ['process.env.X', 'no-restricted-globals'],
  ['window.name', 'no-restricted-globals'],
  ['document.title', 'no-restricted-globals'],
  ['module.exports = {}', 'no-restricted-syntax'],
])('чистое ядро отклоняет %s', async (code, rule) => {
  for (const module of ['packages/domain', 'packages/rules']) {
    const [result] = await eslint.lintText(`${code};\n`, { filePath: `${module}/src/probe.ts` });
    expect(result?.messages.map((m) => m.ruleId)).toContain(rule);
  }
});

it('системные часы и тесты могут читать время', async () => {
  for (const filePath of [
    'packages/domain/src/runtime/system-clock.ts',
    'packages/rules/src/a.test.ts',
  ]) {
    const [result] = await eslint.lintText('export const t = Date.now();\n', { filePath });
    expect(result?.messages.map((m) => m.ruleId)).not.toContain('no-restricted-properties');
  }
});

it('чистое ядро принимает new Date(ms)', async () => {
  const [result] = await eslint.lintText('export const d = new Date(0);\n', {
    filePath: 'packages/domain/src/probe.ts',
  });
  expect(result?.messages).toEqual([]);
});
