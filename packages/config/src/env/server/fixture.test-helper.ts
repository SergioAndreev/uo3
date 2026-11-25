import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, type ConfigIssue } from '../shared/index.js';

/** Выполняет тело во временном каталоге с заданными файлами. */
export function withDir<T>(files: Record<string, string>, body: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'duskmarch-env-'));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true });
  }
}

export function issuesOf(body: () => unknown): readonly ConfigIssue[] {
  try {
    body();
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  return [];
}
