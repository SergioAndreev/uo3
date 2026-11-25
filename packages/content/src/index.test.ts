import { expect, it } from 'vitest';
import { PACKAGE_ID } from './index.js';

it('объявляет идентификатор модуля', () => {
  expect(PACKAGE_ID).toBe('@duskmarch/content');
});
