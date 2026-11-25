import { expect, it } from 'vitest';
import { checkReadiness } from './readiness.js';

it('успех, ошибка и таймаут', async () => {
  expect(await checkReadiness({ a: async () => 1 }, 50)).toEqual({
    status: 'ok',
    dependencies: { a: 'up' },
  });
  const result = await checkReadiness(
    {
      a: async () => 1,
      b: () => {
        throw new Error('x');
      },
      c: () => new Promise(() => undefined),
    },
    20,
  );
  expect(result).toEqual({
    status: 'unavailable',
    dependencies: { a: 'up', b: 'down', c: 'down' },
  });
});
