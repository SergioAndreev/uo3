import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const EXEMPT_LABEL = 'no-changeset-needed';

const isProduction = (file: string): boolean =>
  /^(apps|packages)\/[^/]+\/src\//.test(file) && !/\.test(-helper)?\.tsx?$/.test(file);
const isChangeset = (file: string): boolean =>
  /^\.changeset\/[^/]+\.md$/.test(file) && !file.endsWith('README.md');

/** Changeset объявляет модуль и тип изменения. */
export const isValidChangeset = (text: string): boolean =>
  /^---\r?\n(?:["']?@duskmarch\/[\w-]+["']?: *(?:patch|minor|major)\r?\n)+---\r?\n\s*\S/.test(text);

export function checkChangeset(
  files: readonly string[],
  labels: readonly string[],
  read: (file: string) => string,
): string | undefined {
  if (!files.some(isProduction) || labels.includes(EXEMPT_LABEL)) return undefined;
  const found = files.filter(isChangeset);
  if (found.some((file) => isValidChangeset(read(file)))) return undefined;
  return `нужен файл .changeset/*.md: выполните pnpm changeset (или метка ${EXEMPT_LABEL})`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2] ?? 'origin/main';
  const files = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const labels = (process.env['PR_LABELS'] ?? '').split(',').map((label) => label.trim());
  const error = checkChangeset(files, labels, (f) =>
    existsSync(f) ? readFileSync(f, 'utf8') : '',
  );
  if (error) {
    console.error(error);
    process.exitCode = 1;
  } else console.log('Changeset: OK');
}
