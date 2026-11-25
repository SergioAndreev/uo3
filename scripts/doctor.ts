import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { loadClientConfig } from '@duskmarch/config/env/client';
import { ConfigError, loadServerConfig } from '@duskmarch/config/env/server';
import { checkDbHealth, createDbClient } from '@duskmarch/db';
import { ENV_REGISTRY } from './check-env.js';
import { checkNodeVersion } from './check-node-version.js';
import { corePorts, readRootEnv } from './lib/env-files.js';
import { composeServices, dockerAvailable, probeNats, probeValkey } from './lib/probes.js';

export interface CheckResult {
  name: string;
  ok: boolean;
  /** Что сделать при отказе. */
  hint: string;
}

const UP = (service: string): string => `docker compose --profile core up -d ${service}`;

export function checkEnvFiles(root: string): CheckResult[] {
  return Object.entries(ENV_REGISTRY).map(([example, schema]) => {
    const file = example.replace('.example', '');
    const path = join(root, file);
    if (!existsSync(path)) return { name: file, ok: false, hint: 'создайте: pnpm bootstrap' };
    const env = parseEnv(readFileSync(path, 'utf8')) as Record<string, string>;
    try {
      const isClient = /^apps\/(client|admin)\//.test(file);
      if (isClient) loadClientConfig(schema, env);
      else loadServerConfig(schema, { env, cwd: '/nonexistent' });
      return { name: file, ok: true, hint: '' };
    } catch (error) {
      return {
        name: file,
        ok: false,
        hint: error instanceof ConfigError ? error.message : 'ошибка',
      };
    }
  });
}

export async function checkPostgres(url: string): Promise<CheckResult> {
  const client = createDbClient(url);
  const ok = await checkDbHealth(client.db, 3_000);
  await client.close();
  const at = URL.canParse(url) ? new URL(url).host : 'DATABASE_URL не задан';
  return { name: `PostgreSQL ${at}`, ok, hint: UP('postgres') };
}

export async function checkNetwork(
  env: Record<string, string | undefined>,
): Promise<CheckResult[]> {
  const ports = corePorts(env);
  return Promise.all([
    checkPostgres(env['DATABASE_URL'] ?? ''),
    probeValkey(ports.VALKEY_PORT).then((ok) => ({
      name: `Valkey 127.0.0.1:${ports.VALKEY_PORT}`,
      ok,
      hint: UP('valkey'),
    })),
    probeNats(ports.NATS_PORT).then((ok) => ({
      name: `NATS 127.0.0.1:${ports.NATS_PORT}`,
      ok,
      hint: UP('nats'),
    })),
  ]);
}

export async function doctor(
  root: string,
  env: Record<string, string | undefined> = readRootEnv(root),
): Promise<CheckResult[]> {
  let pnpm = '';
  try {
    pnpm = execFileSync('pnpm', ['-v'], { encoding: 'utf8', cwd: root }).trim();
  } catch {
    // Отсутствие pnpm отражается ниже.
  }
  const docker = dockerAvailable();
  const services = docker ? composeServices(root) : new Map<string, string>();
  return [
    {
      name: `Node.js ${process.version}`,
      ok: checkNodeVersion(process.version).code === 0,
      hint: 'установите Node.js 22',
    },
    { name: `pnpm ${pnpm}`, ok: pnpm.startsWith('9.'), hint: 'corepack enable' },
    { name: 'Docker', ok: docker, hint: 'запустите Docker Engine' },
    ...['postgres', 'valkey', 'nats'].map((service) => ({
      name: `контейнер ${service}`,
      ok: services.get(service) === 'healthy',
      hint: UP(service),
    })),
    ...checkEnvFiles(root),
    ...(await checkNetwork(env)),
  ];
}

export function report(results: readonly CheckResult[]): { text: string; code: number } {
  const lines = results.map(({ ok, name, hint }) =>
    ok ? `PASS  ${name}` : `FAIL  ${name}\n      ${hint}`,
  );
  return { text: lines.join('\n'), code: results.every((r) => r.ok) ? 0 : 1 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { text, code } = report(await doctor(resolve('.')));
  console.log(text);
  process.exitCode = code;
}
