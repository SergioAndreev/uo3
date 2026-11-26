import { expect, it } from 'vitest';
import { issuesOf } from './fixture.test-helper.js';
import { loadServerConfig } from './load.js';
import { ApiEnvSchema } from './schemas/index.js';

const KEY = 'k'.repeat(32);
const PROD_KEYS = {
  IDENTITY_JWT_SIGNING_KEYS_JSON: KEY,
  IDENTITY_TOTP_KEYS_JSON: KEY,
  IDENTITY_BACKUP_CODE_PEPPER: KEY,
};
const env = (extra: Record<string, string>) => ({
  DATABASE_URL: 'postgres://u:p@db/x',
  VALKEY_URL: 'redis://v',
  NATS_URL: 'nats://n',
  ...PROD_KEYS,
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

it('production требует ключи identity', () => {
  const issues = issuesOf(() =>
    loadServerConfig(ApiEnvSchema, {
      cwd: '/nonexistent',
      env: {
        DATABASE_URL: 'postgres://u:p@db/x',
        VALKEY_URL: 'redis://v',
        NATS_URL: 'nats://n',
        NODE_ENV: 'production',
      },
    }),
  );
  expect(issues.map((i) => i.key).sort()).toEqual(Object.keys(PROD_KEYS).sort());
});

it('production принимает безопасные значения', () => {
  expect(load({ NODE_ENV: 'production' })).toEqual([]);
  expect(
    load({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: '*', CORS_ALLOW_CREDENTIALS: '0' }),
  ).toEqual([]);
});
