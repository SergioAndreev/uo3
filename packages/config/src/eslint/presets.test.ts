import { ESLint, Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import base from './base.js';
import boundaries from './boundaries.js';
import browser from './browser.js';
import server from './server.js';

const rulesFor = (config: Linter.Config[], code: string): (string | null)[] =>
  new Linter().verify(code, config).map((message) => message.ruleId);

describe('flat-конфиги', () => {
  it.each(Object.entries({ base, browser, server, boundaries }))(
    '%s проходит схему',
    async (_, c) => {
      const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: c });
      await expect(
        eslint.calculateConfigForFile(c === boundaries ? 'packages/domain/src/a.ts' : 'a.js'),
      ).resolves.toBeDefined();
    },
  );

  it.each([
    ["const x = require('node:fs'); console.log(x)", '@typescript-eslint/no-require-imports'],
    ['module.exports = {}', 'no-restricted-syntax'],
  ])('отклоняет %s', (code, rule) => {
    expect(rulesFor(base, code)).toContain(rule);
  });

  it.each([
    ["eval('1')", 'no-eval'],
    ["new Function('return 1')", 'no-new-func'],
    ["setTimeout('x()', 1)", 'no-implied-eval'],
    ["import '@duskmarch/db'", 'no-restricted-imports'],
    ["import 'node:fs'", 'no-restricted-imports'],
  ])('браузер отклоняет %s', (code, rule) => {
    const globals = { setTimeout: 'readonly', window: 'readonly' } as const;
    expect(rulesFor([...browser, { languageOptions: { globals } }], code)).toContain(rule);
  });

  it('сервер отклоняет UI', () => {
    expect(rulesFor(server, "import '@duskmarch/ui-kit'")).toContain('no-restricted-imports');
  });
});
