import { expect, it } from 'vitest';
import * as client from './client.js';
import * as server from './server.js';
import { deepFreeze } from './shared.js';

it('замораживает вложенные значения', () => {
  const value = deepFreeze({ a: { b: [1] }, c: null });
  expect(Object.isFrozen(value.a.b)).toBe(true);
  expect(deepFreeze(5)).toBe(5);
});

it('все точки входа используют общую реализацию', () => {
  expect(client.deepFreeze).toBe(deepFreeze);
  expect(server.deepFreeze).toBe(deepFreeze);
});
