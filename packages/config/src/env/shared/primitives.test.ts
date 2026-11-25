import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import * as p from './index.js';

const accepts = (field: ReturnType<typeof Type.Any>, raw: string): boolean =>
  p.resolveFields(Type.Object({ K: field }) as p.EnvSchema, { K: raw }, (s, v) => Value.Check(s, v))
    .issues.length === 0;
const cases = (field: unknown, good: string[], bad: string[]): void => {
  for (const raw of good) expect(accepts(field as never, raw), raw).toBe(true);
  for (const raw of bad) expect(accepts(field as never, raw), raw).toBe(false);
};

describe('примитивы', () => {
  it('порты', () =>
    cases(p.Port(), ['1', '65535'], ['0', '65536', '-1', '1.5', '1e3', ' 80', 'x']));
  it('таймауты', () => cases(p.TimeoutMs(), ['1', '15000'], ['0', '-1', '99999999999999999999']));
  it('булевы', () => cases(p.Flag(), ['true', 'false', '1', '0'], ['yes', '2', 'TRUE']));
  it('уровни', () => cases(p.LogLevel(), ['fatal', 'trace'], ['verbose', 'INFO']));
  it('среды', () => cases(p.AppEnv(), ['test', 'staging', 'production'], ['prod']));
  it('списки', () => cases(p.CsvList(), ['a', 'a, b'], ['a,,b']));
  it('строки', () => cases(p.Text({ pattern: '^[a-z]+$' }), ['abc'], ['ABC']));
  it.each([
    ['http', ['http://a', 'https://a:1/x'], ['ftp://a', 'a', 'http://']],
    ['ws', ['ws://a', 'wss://a'], ['http://a']],
    ['postgres', ['postgres://a/b', 'postgresql://u:p@a/b'], ['mysql://a', 'postgres:///b']],
    ['redis', ['redis://a', 'rediss://a'], ['http://a']],
    ['nats', ['nats://a', 'tls://a'], ['ftp://localhost:4222']],
  ] as const)('URL %s', (kind, good, bad) => cases(p.Url(kind), [...good], [...bad]));

  it('значение по умолчанию не разделяется между загрузками', () => {
    const schema = Type.Object({ K: p.CsvList({ default: ['a'] }) });
    const load = () => p.resolveFields(schema, { K: '' }, () => true).config['K'];
    expect(load()).toEqual(['a']);
    expect(load()).not.toBe(load());
  });
});
