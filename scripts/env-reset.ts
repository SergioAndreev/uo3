import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDbClient } from '@duskmarch/db';
import { readRootEnv } from './lib/env-files.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', 'postgres']);
const RESETTABLE = new Set(['duskmarch_dev', 'duskmarch_test']);

/** Возвращает причину отказа или `undefined`, если сброс разрешён. */
export function refuseReason(
  urls: readonly (string | undefined)[],
  confirmed: boolean,
): string | undefined {
  for (const raw of urls) {
    if (!raw || !URL.canParse(raw)) return 'DATABASE_URL и DATABASE_TEST_URL должны быть заданы';
    const url = new URL(raw);
    // `host` и `hostaddr` в параметрах переопределяют хост при подключении.
    if (!LOCAL_HOSTS.has(url.hostname) || /[?&]host(addr)?=/i.test(url.search)) {
      return `сброс нелокальной БД запрещён: ${url.hostname}`;
    }
    const name = url.pathname.slice(1);
    if (!RESETTABLE.has(name)) return `база ${name} не входит в список разрешённых`;
  }
  return confirmed ? undefined : 'добавьте --yes: данные будут удалены';
}

async function recreate(raw: string): Promise<void> {
  const url = new URL(raw);
  const name = url.pathname.slice(1);
  const execute = async (database: string, statements: string[]): Promise<void> => {
    url.pathname = `/${database}`;
    const client = createDbClient(url.href);
    try {
      for (const statement of statements) await client.db.execute(statement);
    } finally {
      await client.close();
    }
  };
  await execute('postgres', [
    `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`,
    `CREATE DATABASE ${name}`,
  ]);
  await execute(name, [
    'CREATE EXTENSION IF NOT EXISTS pgcrypto',
    'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"',
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = readRootEnv(resolve('.'));
  const urls = [env['DATABASE_URL'], env['DATABASE_TEST_URL']];
  const reason = refuseReason(urls, process.argv.includes('--yes'));
  if (reason) {
    console.error(`env:reset: ${reason}`);
    process.exitCode = 1;
  } else {
    for (const url of urls) if (url) await recreate(url);
    const failed = ['db:migrate', 'db:seed'].some(
      (step) => spawnSync('pnpm', [step], { stdio: 'inherit' }).status !== 0,
    );
    console.log(failed ? 'env:reset завершился с ошибкой' : 'Локальные базы пересозданы');
    process.exitCode = failed ? 1 : 0;
  }
}
