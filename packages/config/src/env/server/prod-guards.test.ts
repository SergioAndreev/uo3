import { expect, it } from 'vitest';
import { issuesOf } from './fixture.test-helper.js';
import { loadServerConfig } from './load.js';
import { ApiEnvSchema } from './schemas/index.js';

const env = (extra: Record<string, string>) => ({
  DATABASE_URL: 'postgres://u:p@db/x',
  VALKEY_URL: 'redis://v',
  NATS_URL: 'nats://n',
  ...extra,
});
const load = (extra: Record<string, string>) =>
  issuesOf(() => loadServerConfig(ApiEnvSchema, { cwd: '/nonexistent', env: env(extra) }));

it.each<[string, Record<string, string>]>([
  [
    'IDENTITY_JWT_SIGNING_KEYS_JSON',
    { IDENTITY_JWT_SIGNING_KEYS_JSON: 'CHANGE_ME_LOCAL_DEV_ONLY' },
  ],
  ['IDENTITY_JWT_SIGNING_KEYS_JSON', { IDENTITY_JWT_SIGNING_KEYS_JSON: 'abc123short' }],
  ['DATABASE_URL', { DATABASE_URL: 'postgres://u:CHANGE_ME_X@db/x' }],
  ['VALKEY_PASSWORD', { VALKEY_PASSWORD: 'dev-secret' }],
  ['CORS_ALLOWED_ORIGINS', { CORS_ALLOWED_ORIGINS: '*', CORS_ALLOW_CREDENTIALS: 'true' }],
])('production отклоняет %s %o', (key, extra) => {
  const issues = load({ NODE_ENV: 'production', ...extra });
  expect(issues.map((i) => [i.code, i.key])).toEqual([['CONFIG_INSECURE_PROD_VALUE', key]]);
  expect(JSON.stringify(issues)).not.toMatch(/abc123short|CHANGE_ME_X/);
  for (const NODE_ENV of ['development', 'test']) expect(load({ NODE_ENV, ...extra })).toEqual([]);
});

it('production принимает безопасные значения', () => {
  const key = 'k'.repeat(32);
  expect(load({ NODE_ENV: 'production', IDENTITY_JWT_SIGNING_KEYS_JSON: key })).toEqual([]);
  expect(
    load({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: '*', CORS_ALLOW_CREDENTIALS: '0' }),
  ).toEqual([]);
});
