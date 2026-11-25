import { expect, it } from 'vitest';
import { issuesOf } from '../fixture.test-helper.js';
import { loadServerConfig } from '../load.js';
import {
  ApiEnvSchema,
  AssetToolEnvSchema,
  BotClientEnvSchema,
  DbEnvSchema,
  GameServerEnvSchema,
  WorkspaceEnvSchema,
} from './index.js';

const infra = {
  DATABASE_URL: 'postgres://u:p@h/x',
  VALKEY_URL: 'redis://h',
  NATS_URL: 'nats://h',
};
const bot = { TARGET_API_URL: 'http://h', TARGET_GAME_WS_URL: 'ws://h' };
const keys = (schema: Parameters<typeof loadServerConfig>[0], env: Record<string, string>) =>
  issuesOf(() => loadServerConfig(schema, { env, cwd: '/nonexistent' })).map((i) => i.key);

it.each([
  ['api', ApiEnvSchema, infra],
  ['game', GameServerEnvSchema, infra],
  ['db', DbEnvSchema, infra],
  ['asset', AssetToolEnvSchema, {}],
  ['bot', BotClientEnvSchema, bot],
  ['workspace', WorkspaceEnvSchema, { ...infra, PG_PASSWORD: 'x' }],
])('%s принимает эталон, все поля описаны', (_, schema, env) => {
  expect(keys(schema, env as Record<string, string>)).toEqual([]);
  for (const field of Object.values(schema.properties)) expect(field.description).toBeTruthy();
});

it('отклоняет нарушения одним отчётом', () => {
  const env = { ...infra, ENABLE_SWAGGER: 'yes', NATS_URL: 'ftp://localhost:4222', API_PORT: '0' };
  expect(keys(ApiEnvSchema, env).sort()).toEqual(['API_PORT', 'ENABLE_SWAGGER', 'NATS_URL']);
  expect(keys(GameServerEnvSchema, { ...infra, SHARD_ID: 'A B', GAME_PORT: 'x' })).toHaveLength(2);
  expect(keys(BotClientEnvSchema, { ...bot, BOT_CONCURRENCY: '5001' })).toEqual([
    'BOT_CONCURRENCY',
  ]);
});

it('приводит типы', () => {
  const env = { ...infra, API_PORT: '3001', SHUTDOWN_TIMEOUT_MS: '15000', ENABLE_SWAGGER: 'true' };
  expect(loadServerConfig(ApiEnvSchema, { env, cwd: '/x' })).toMatchObject({
    API_PORT: 3001,
    SHUTDOWN_TIMEOUT_MS: 15000,
    ENABLE_SWAGGER: true,
  });
});
