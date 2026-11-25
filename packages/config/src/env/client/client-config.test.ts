import { Type } from '@sinclair/typebox';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Text, createSecretSchema } from '../shared/index.js';
import {
  AdminEnvSchema,
  ClientEnvSchema,
  assertClientSchemaSafe,
  loadClientConfig,
} from './index.js';

const env = { VITE_API_BASE_URL: 'http://localhost:3001', VITE_GAME_WS_URL: 'ws://localhost:2567' };

it('загружает только публичные ключи', () => {
  const config = loadClientConfig(ClientEnvSchema, { ...env, DEV: true, DATABASE_URL: 'x' });
  expect(Object.keys(config).every((key) => key.startsWith('VITE_'))).toBe(true);
  expect(Object.isFrozen(config)).toBe(true);
});

it('отклоняет невалидные значения', () => {
  expect(() => loadClientConfig(ClientEnvSchema, { ...env, VITE_GAME_WS_URL: 'http://a' })).toThrow(
    'VITE_GAME_WS_URL',
  );
});

it('схемы приложений безопасны', () => {
  for (const schema of [ClientEnvSchema, AdminEnvSchema]) {
    expect(() => assertClientSchemaSafe(schema)).not.toThrow();
  }
});

it.each([
  Type.Object({ DATABASE_URL: Text() }),
  Type.Object({ VITE_JWT_PRIVATE_KEY: createSecretSchema() }),
])('отклоняет секреты в схеме %#', (schema) => {
  expect(() => loadClientConfig(schema, {})).toThrow('CONFIG_CLIENT_SECRET_FORBIDDEN');
});

it('не использует компилятор TypeBox (CSP без eval)', () => {
  expect(readFileSync('src/env/client/load.ts', 'utf8')).not.toContain('typebox/compiler');
});
