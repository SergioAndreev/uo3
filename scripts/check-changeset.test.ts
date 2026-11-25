import { expect, it } from 'vitest';
import { checkChangeset } from './check-changeset.js';

const valid = "---\n'@duskmarch/db': patch\n---\n\nОписание\n";
const check = (files: string[], labels: string[] = [], text = valid) =>
  checkChangeset(files, labels, () => text);

it.each([
  [['packages/db/src/a.ts', '.changeset/x.md'], []],
  [['packages/db/src/a.ts'], ['no-changeset-needed']],
  [['docs/a.md', 'openspec/b.md', '.github/workflows/ci.yml'], []],
  [['packages/db/src/a.test.ts'], []],
])('пропускает %j %j', (files, labels) => expect(check(files, labels)).toBeUndefined());

it('требует валидный changeset', () => {
  expect(check(['packages/db/src/a.ts'])).toContain('pnpm changeset');
  expect(check(['apps/api/src/a.ts', '.changeset/README.md'])).toBeDefined();
  expect(check(['apps/api/src/a.ts', '.changeset/x.md'], [], 'пусто')).toBeDefined();
});
