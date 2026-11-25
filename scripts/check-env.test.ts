import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { loadClientConfig } from '@duskmarch/config/env/client';
import { loadServerConfig } from '@duskmarch/config/env/server';
import { expect, it } from 'vitest';
import { ENV_REGISTRY, checkEnv, compareKeys } from './check-env.js';

it('шаблоны репозитория синхронны', () => expect(checkEnv('.')).toEqual([]));

it('сообщает об отсутствующих файлах', () => {
  expect(checkEnv('/nonexistent')).toHaveLength(7);
});

it.each([
  ['A=1\nB=', []],
  ['# B=2\nA=1', ['отсутствует B']],
  ['A=1\nB=2\nOLD=3', ['лишний OLD']],
  ['A=1\nB=2\nA=3', ['дублируется A']],
])('%j', (text, expected) => expect(compareKeys(text, ['A', 'B'])).toEqual(expected));

it.each(Object.entries(ENV_REGISTRY))('%s загружается своей схемой', (file, schema) => {
  const env = parseEnv(readFileSync(file, 'utf8')) as Record<string, string>;
  const load = () =>
    /client|admin/.test(file) && !file.includes('bot-client')
      ? loadClientConfig(schema, env)
      : loadServerConfig(schema, { env, cwd: '/nonexistent' });
  expect(load).not.toThrow();
});
