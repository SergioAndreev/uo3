import { Type } from '@sinclair/typebox';
import { expect, it } from 'vitest';
import {
  Text,
  createSecretSchema,
  createSensitiveUriSchema,
  redactConfig,
  redactUri,
} from './index.js';

it('маскирует секреты и пароль URI', () => {
  const schema = Type.Object({
    DATABASE_URL: createSensitiveUriSchema('postgres'),
    KEY: createSecretSchema(),
    NAME: Text(),
    NONE: Type.Optional(createSecretSchema()),
  });
  const view = redactConfig(schema, {
    DATABASE_URL: 'postgresql://duskmarch:s3cr3tPass@localhost:5432/duskmarch_dev',
    KEY: 's3cr3tPass',
    NAME: 'n',
    EXTRA: 's3cr3tPass',
  });
  expect(view).toEqual({
    DATABASE_URL: 'postgresql://duskmarch:[REDACTED]@localhost:5432/duskmarch_dev',
    KEY: '[REDACTED]',
    NAME: 'n',
  });
  expect(JSON.stringify(view)).not.toContain('s3cr3tPass');
});

it.each([
  ['not a uri s3cr3t', '[REDACTED_INVALID_URI]'],
  ['s3cr3t:pass', '[REDACTED_INVALID_URI]'],
  ['redis://u@h:1/0', 'redis://u@h:1/0'],
  ['postgres://h/db?password=s3cr3t', 'postgres://h/db?[REDACTED]'],
])('URI %s', (raw, expected) => expect(redactUri(raw)).toBe(expected));
