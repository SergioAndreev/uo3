import { expect, it } from 'vitest';
import { ValkeyEnvSchema } from './schemas/index.js';
import { issuesOf, withDir } from './fixture.test-helper.js';
import { loadServerConfig } from './load.js';

const base = { VALKEY_URL: 'redis://localhost' };

it('читает файл и удаляет завершающие переводы строки', () =>
  withDir({ key: 'value\r\n\n' }, (cwd) => {
    const env = { ...base, VALKEY_PASSWORD_FILE: `${cwd}/key` };
    expect(loadServerConfig(ValkeyEnvSchema, { cwd, env }).VALKEY_PASSWORD).toBe('value');
  }));

it('сообщает о конфликте один раз', () =>
  withDir({ key: 'redis://h' }, (cwd) => {
    const env = { ...base, VALKEY_URL_FILE: `${cwd}/key` };
    const issues = issuesOf(() => loadServerConfig(ValkeyEnvSchema, { cwd, env }));
    expect(issues.map((i) => [i.code, i.key])).toEqual([['CONFIG_CONFLICT', 'VALKEY_URL']]);
  }));

it.each(['missing', 'empty', 'blank'])('отклоняет файл %s', (name) =>
  withDir({ empty: '', blank: ' \n' }, (cwd) => {
    const env = { ...base, VALKEY_PASSWORD_FILE: `${cwd}/${name}` };
    const issues = issuesOf(() => loadServerConfig(ValkeyEnvSchema, { cwd, env }));
    expect(issues[0]?.code).toBe('CONFIG_SECRET_FILE_ERROR');
  }),
);
