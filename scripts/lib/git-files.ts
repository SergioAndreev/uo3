import { execFileSync } from 'node:child_process';

export interface GitFile {
  path: string;
  content: Buffer;
}

const git = (cwd: string, args: string[]): Buffer =>
  execFileSync('git', args, { cwd, maxBuffer: 256 * 1024 * 1024 });

/** Файлы индекса: все или только изменённые. Содержимое берётся из индекса, не с диска. */
export function listGitFiles(cwd: string, staged: boolean): GitFile[] {
  const args = staged
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
    : ['ls-files', '-z'];
  return git(cwd, args)
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((path) => !git(cwd, ['ls-files', '-s', '--', path]).toString().startsWith('160000'))
    .map((path) => ({ path, content: git(cwd, ['show', `:${path}`]) }));
}
