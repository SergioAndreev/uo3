import { expect, it } from 'vitest';
import { createMarkerFactory } from './index.js';

it('маркеры предсказуемы, фабрики независимы', () => {
  const a = createMarkerFactory('a');
  expect([a(), a(), createMarkerFactory('b')()]).toEqual(['a-1', 'a-2', 'b-1']);
});
