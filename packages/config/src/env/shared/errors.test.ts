import { expect, it } from 'vitest';
import { ConfigError, ConfigErrorCode } from './index.js';

it('агрегирует и форматирует все ошибки', () => {
  const error = new ConfigError([
    { code: ConfigErrorCode.VALIDATION_FAILED, key: 'A', message: 'a' },
    { code: ConfigErrorCode.CONFLICT, key: 'B', message: 'b' },
  ]);
  expect(error.issues).toHaveLength(2);
  expect(error.message).toContain('ошибок: 2');
  expect(error.message).toContain('[CONFIG_CONFLICT] B: b');
});
