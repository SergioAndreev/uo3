import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, expect, it } from 'vitest';

// Отдельный проект и порты: рабочий стенд не затрагивается.
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: 'duskmarch-itest',
  PG_PORT: '15432',
  VALKEY_PORT: '16379',
  NATS_PORT: '14222',
  NATS_MONITOR_PORT: '18222',
};
const compose = (...args: string[]): string =>
  execFileSync('docker', ['compose', '--profile', 'core', ...args], { env, encoding: 'utf8' });
const psql = (sql: string): string =>
  compose('exec', '-T', 'postgres', 'psql', '-U', 'duskmarch', '-d', 'duskmarch_dev', '-tAc', sql);
const jetstream = async () => {
  const response = await fetch('http://127.0.0.1:18222/jsz');
  return (await response.json()) as { config: { store_dir: string } };
};

beforeAll(() => {
  execFileSync('docker', ['compose', '--profile', 'core', 'pull', '-q'], { env });
}, 300_000);
afterAll(() => void compose('down', '-v'), 60_000);

it('стенд готов за 60 с, порты переопределены, JetStream активен', async () => {
  const start = performance.now();
  compose('up', '-d', '--wait');
  expect(performance.now() - start).toBeLessThanOrEqual(60_000);
  expect(compose('port', 'postgres', '5432').trim()).toBe('127.0.0.1:15432');
  expect((await jetstream()).config.store_dir).toContain('/data/jetstream');
  const databases = psql("select datname from pg_database where datname like 'duskmarch_%'");
  expect(databases.trim().split('\n').sort()).toEqual(['duskmarch_dev', 'duskmarch_test']);
  expect(psql('select extname from pg_extension')).toMatch(/pgcrypto[\s\S]*uuid-ossp/);
}, 120_000);

it('данные переживают пересоздание контейнеров', async () => {
  psql('create table probe (id int); insert into probe values (7)');
  compose('exec', '-T', 'nats', 'sh', '-c', 'echo kept > /data/probe');
  compose('down');
  compose('up', '-d', '--wait');
  expect(psql('select id from probe').trim()).toBe('7');
  expect(compose('exec', '-T', 'nats', 'cat', '/data/probe').trim()).toBe('kept');
}, 120_000);
