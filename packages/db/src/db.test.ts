import { existsSync } from 'node:fs';
import { DbEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { expect, it, vi } from 'vitest';
import {
  MIGRATIONS_DIR,
  SEED_ROWS,
  checkDbHealth,
  createDbClient,
  seedDatabase,
  type Database,
} from './index.js';

const fake = (execute: () => Promise<unknown>) => ({ execute }) as unknown as Database;

it('checkDbHealth различает успех, ошибку и таймаут', async () => {
  expect(
    await checkDbHealth(
      fake(async () => []),
      50,
    ),
  ).toBe(true);
  expect(
    await checkDbHealth(
      fake(async () => Promise.reject(new Error('x'))),
      50,
    ),
  ).toBe(false);
  expect(
    await checkDbHealth(
      fake(() => new Promise(() => undefined)),
      20,
    ),
  ).toBe(false);
});

it('недоступная БД не вызывает исключения', async () => {
  const client = createDbClient('postgres://u:p@127.0.0.1:1/x');
  expect(await checkDbHealth(client.db, 2_000)).toBe(false);
  await client.close();
});

it('DbEnvSchema отклоняет чужой протокол', () => {
  const load = () =>
    loadServerConfig(DbEnvSchema, { env: { DATABASE_URL: 'mysql://h' }, cwd: '/x' });
  expect(load).toThrow('DATABASE_URL');
});

it('seed записывает уникальные строки в транзакции', async () => {
  const onConflictDoUpdate = vi.fn();
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const transaction = vi.fn(async (body: (tx: unknown) => Promise<void>) =>
    body({ insert: () => ({ values }) }),
  );
  await seedDatabase({ transaction } as unknown as Database);
  expect(values).toHaveBeenCalledWith([...SEED_ROWS]);
  expect(onConflictDoUpdate).toHaveBeenCalledOnce();
  expect(new Set(SEED_ROWS.map((row) => row.key)).size).toBe(SEED_ROWS.length);
});

it('каталог миграций существует', () => expect(existsSync(MIGRATIONS_DIR)).toBe(true));
