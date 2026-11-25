import { expect, it } from 'vitest';
import { deepFreeze } from './deep-freeze.js';

it('запрещает мутацию на всех уровнях', () => {
  const value = deepFreeze({ a: 1, b: { c: [1] }, n: null });
  expect(() => void (value.a = 2)).toThrow(TypeError);
  expect(() => void (value.b.c[0] = 2)).toThrow(TypeError);
  expect(() => value.b.c.push(2)).toThrow(TypeError);
  expect(value).toEqual({ a: 1, b: { c: [1] }, n: null });
});
