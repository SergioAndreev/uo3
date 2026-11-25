import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listGitFiles, type GitFile } from './lib/git-files.js';

interface Finding {
  RuleID: string;
  File: string;
  StartLine: number;
}

/** Копирует файлы во временный каталог и проверяет их gitleaks. Значения не выводятся. */
export function checkSecrets(files: readonly GitFile[], config: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'duskmarch-secrets-'));
  try {
    const tree = join(dir, 'tree');
    mkdirSync(tree);
    for (const { path, content } of files) {
      const target = join(tree, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    const run = spawnSync(
      'gitleaks',
      ['dir', '.', '-c', config, '--redact=100', '--no-banner', '-f', 'json', '-r', '-'],
      { cwd: tree, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    if (run.error || (run.status !== 0 && run.status !== 1)) {
      throw new Error('gitleaks не запустился: установите gitleaks 8 (см. CONTRIBUTING.md)');
    }
    const findings = JSON.parse(run.stdout || '[]') as Finding[] | null;
    return (findings ?? []).map((f) => `${f.File}:${f.StartLine}: ${f.RuleID}`);
  } finally {
    rmSync(dir, { recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve('.');
  const files = listGitFiles(root, process.argv.includes('--staged'));
  const errors = checkSecrets(files, join(root, '.gitleaks.toml'));
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exitCode = 1;
  else console.log(`Секреты: проверено файлов ${files.length}`);
}
