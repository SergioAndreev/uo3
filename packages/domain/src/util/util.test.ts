import { expect, it } from 'vitest';
import { canonicalJson, deepFreeze } from './index.js';

it('замораживает вложенные объекты и массивы, допускает циклы', () => {
  const value: { a: { b: number[] }; self?: unknown } = { a: { b: [1, 2] } };
  value.self = value;
  const frozen = deepFreeze(value);
  expect(Object.isFrozen(frozen.a.b)).toBe(true);
  expect(() => {
    (value.a.b as number[]).push(3);
  }).toThrow(TypeError);
});

it('не зависит от порядка ключей', () => {
  expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: 'з' } })).toBe(
    canonicalJson({ a: { c: 'з', d: [1, { x: 1, y: 2 }] }, b: 1 }),
  );
  expect(canonicalJson({ b: 1, a: null, c: true })).toBe('{"a":null,"b":1,"c":true}');
});

it.each([
  [{ a: undefined }, '$.a'],
  [{ a: Number.NaN }, '$.a'],
  [[Infinity], '$[0]'],
  [{ f: () => 1 }, '$.f'],
])('отклоняет %o', (value, path) => {
  expect(() => canonicalJson(value)).toThrow(path);
});

it('отклоняет циклы, но допускает повтор одной ссылки', () => {
  const shared = { x: 1 };
  expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  const loop: Record<string, unknown> = {};
  loop['self'] = loop;
  expect(() => canonicalJson(loop)).toThrow('циклическая');
});
