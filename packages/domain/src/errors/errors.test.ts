import { expect, it } from 'vitest';
import { DOMAIN_ERROR_CODES, DomainError, isDomainError } from './index.js';

it('коды уникальны и имеют префикс ERR_', () => {
  expect(new Set(DOMAIN_ERROR_CODES).size).toBe(DOMAIN_ERROR_CODES.length);
  for (const code of DOMAIN_ERROR_CODES) expect(code).toMatch(/^ERR_[A-Z_]+$/);
});

it('сериализуется с кодом, путём и деталями', () => {
  const error = new DomainError('ERR_RULESET_INVARIANT', 'бег медленнее ходьбы', {
    fieldPath: 'movement.runMs',
    details: { value: 400 },
  });
  expect(JSON.parse(JSON.stringify(error))).toEqual({
    code: 'ERR_RULESET_INVARIANT',
    message: 'ERR_RULESET_INVARIANT: бег медленнее ходьбы',
    fieldPath: 'movement.runMs',
    details: { value: 400 },
  });
  expect(Object.isFrozen(error.details)).toBe(true);
  expect(isDomainError(error, 'ERR_RULESET_INVARIANT')).toBe(true);
  expect(isDomainError(error, 'ERR_INVALID_DICE')).toBe(false);
  expect(isDomainError(new Error('x'))).toBe(false);
});

it('без пути поле не выводится', () => {
  expect(new DomainError('ERR_INVALID_DICE', 'x').toJSON()).not.toHaveProperty('fieldPath');
});
