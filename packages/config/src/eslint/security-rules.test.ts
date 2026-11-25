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
