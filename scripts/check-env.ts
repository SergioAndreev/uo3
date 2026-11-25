import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AdminEnvSchema, ClientEnvSchema } from '@duskmarch/config/env/client';
import {
  ApiEnvSchema,
  AssetToolEnvSchema,
  BotClientEnvSchema,
  GameServerEnvSchema,
  WorkspaceEnvSchema,
  type EnvSchema,
} from '@duskmarch/config/env/server';

export const ENV_REGISTRY: Readonly<Record<string, EnvSchema>> = {
  '.env.example': WorkspaceEnvSchema,
  'apps/admin/.env.example': AdminEnvSchema,
  'apps/api/.env.example': ApiEnvSchema,
  'apps/asset-tool/.env.example': AssetToolEnvSchema,
  'apps/bot-client/.env.example': BotClientEnvSchema,
  'apps/client/.env.example': ClientEnvSchema,
  'apps/game-server/.env.example': GameServerEnvSchema,
};

/** Сверяет ключи шаблона со схемой. */
export function compareKeys(text: string, schemaKeys: readonly string[]): string[] {
  const keys = [...text.matchAll(/^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=/gm)].map((m) => m[1] ?? '');
  const unique = new Set(keys);
  return [
    ...schemaKeys.filter((key) => !unique.has(key)).map((key) => `отсутствует ${key}`),
    ...[...unique].filter((key) => !schemaKeys.includes(key)).map((key) => `лишний ${key}`),
    ...[...unique]
      .filter((key) => keys.filter((other) => other === key).length > 1)
      .map((key) => `дублируется ${key}`),
  ];
}

export function checkEnv(root: string): string[] {
  return Object.entries(ENV_REGISTRY).flatMap(([file, schema]) => {
    const path = join(root, file);
    if (!existsSync(path)) return [`${file}: файл не найден`];
    return compareKeys(readFileSync(path, 'utf8'), Object.keys(schema.properties)).map(
      (problem) => `${file}: ${problem}`,
    );
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = checkEnv(resolve('.'));
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exitCode = 1;
  else console.log('Шаблоны .env.example соответствуют схемам');
}
