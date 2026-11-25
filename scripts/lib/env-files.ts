import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export const APP_DIRS = ['admin', 'api', 'asset-tool', 'bot-client', 'client', 'game-server'];

/** Порты стенда: переменная и значение шаблона. */
export const CORE_PORTS = {
  PG_PORT: 5432,
  VALKEY_PORT: 6379,
  NATS_PORT: 4222,
  NATS_MONITOR_PORT: 8222,
} as const;
export type PortKey = keyof typeof CORE_PORTS;

/** Корневой `.env`; окружение процесса важнее. */
export function readRootEnv(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  const file = join(root, '.env');
  const own = Object.entries(env).filter(([, value]) => value !== undefined && value !== '');
  return {
    ...(existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}),
    ...Object.fromEntries(own),
  };
}

export function corePorts(env: Record<string, string | undefined>): Record<PortKey, number> {
  const entries = Object.entries(CORE_PORTS).map(([key, value]) => [
    key,
    Number(env[key] || value),
  ]);
  return Object.fromEntries(entries) as Record<PortKey, number>;
}

/** Создаёт недостающие `.env`; в файлах приложений подставляет порты стенда. */
export function createMissingEnvFiles(root: string): string[] {
  const created: string[] = [];
  if (!existsSync(join(root, '.env'))) {
    copyFileSync(join(root, '.env.example'), join(root, '.env'));
    created.push('.env');
  }
  const ports = corePorts(readRootEnv(root, {}));
  for (const app of APP_DIRS) {
    const target = join(root, 'apps', app, '.env');
    if (existsSync(target)) continue;
    let text = readFileSync(`${target}.example`, 'utf8');
    for (const [key, value] of Object.entries(CORE_PORTS)) {
      text = text.replaceAll(`127.0.0.1:${value}`, `127.0.0.1:${ports[key as PortKey]}`);
    }
    writeFileSync(target, text);
    created.push(`apps/${app}/.env`);
  }
  return created;
}
