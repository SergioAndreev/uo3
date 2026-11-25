import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

/** Значения `.env*` по возрастанию приоритета. В production файлы не читаются. */
export function loadDotEnvFiles(cwd: string, nodeEnv: string): Record<string, string> {
  const merged: Record<string, string> = {};
  if (nodeEnv === 'production') return merged;
  for (const name of ['.env', '.env.local', `.env.${nodeEnv}.local`]) {
    const file = join(cwd, name);
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return merged;
}
