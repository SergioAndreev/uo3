import { Type } from '@sinclair/typebox';
import { expect, it } from 'vitest';
import { AppEnv, Text, createSecretSchema } from '../shared/index.js';
import { issuesOf, withDir } from './fixture.test-helper.js';
import { loadServerConfig } from './load.js';

const schema = Type.Object({
  NODE_ENV: AppEnv(),
  V: Text({ default: 'default' }),
  S: Type.Optional(createSecretSchema()),
});
const files = {
  '.env': 'V=base\nS=base',
  '.env.local': 'V=local',
  '.env.test.local': 'V=test-local',
  secret: 'from-file',
};

it('соблюдает порядок источников', () =>
  withDir(files, (cwd) => {
    const v = (env: Record<string, string>) => loadServerConfig(schema, { cwd, env }).V;
    expect(v({ NODE_ENV: 'test', V: 'process' })).toBe('process');
    expect(v({ NODE_ENV: 'test' })).toBe('test-local');
    expect(v({ NODE_ENV: 'development' })).toBe('local');
    expect(v({ NODE_ENV: 'test', V: '' })).toBe('test-local');
  }));

it('процесс важнее файла секрета, файл важнее .env', () =>
  withDir(files, (cwd) => {
    const env = { S_FILE: `${cwd}/secret` };
    expect(loadServerConfig(schema, { cwd, env }).S).toBe('from-file');
  }));

it('процесс важнее S_FILE из .env', () =>
  withDir({ '.env': 'S_FILE=/nonexistent' }, (cwd) => {
    expect(loadServerConfig(schema, { cwd, env: { S: 'process' } }).S).toBe('process');
  }));

it('production игнорирует .env', () =>
  withDir({ '.env': 'S=x' }, (cwd) => {
    const env = { NODE_ENV: 'production' };
    expect(loadServerConfig(schema, { cwd, env }).V).toBe('default');
    const required = Type.Object({ NODE_ENV: AppEnv(), S: createSecretSchema() });
    expect(issuesOf(() => loadServerConfig(required, { cwd, env }))[0]?.key).toBe('S');
  }));

it('NODE_ENV из .env не влияет на среду', () =>
  withDir({ '.env': 'NODE_ENV=production' }, (cwd) => {
    expect(loadServerConfig(schema, { cwd, env: {} }).NODE_ENV).toBe('development');
  }));
