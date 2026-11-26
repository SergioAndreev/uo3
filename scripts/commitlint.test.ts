import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

const run = (input: string): number | null =>
  spawnSync('node_modules/.bin/commitlint', { input, encoding: 'utf8' }).status;

it.each([
  ['feat(config): add typed loader', 0],
  ['docs(p00): update bootstrap instructions', 0],
  ['feat(p00): каркас монорепозитория', 0],
  ['Revert "feat(config): add typed loader"', 0],
  ['chore(release): version packages', 0],
  ["Merge branch 'claude' into main", 0],
  ['fix bug', 1],
  ['feat(unknown): x', 1],
  [`feat(config): ${'a'.repeat(106)}`, 1],
])('%s → %i', (message, code) => expect(run(message)).toBe(code));
