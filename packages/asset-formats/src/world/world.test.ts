import { expect, it } from 'vitest';
import { chunkKey, chunkPath, validateWorldIndex, type WorldIndex } from './index.js';

const hash = 'a'.repeat(64);
const index = (chunks: [number, number][], size = 64): WorldIndex => ({
  schemaVersion: 1,
  realm: { id: 255, key: 'proving' },
  width: size,
  height: size,
  chunkSize: 32,
  chunks: chunks.map(([cx, cy]) => ({ cx, cy, key: chunkKey('proving', cx, cy), sha256: hash })),
  landmarks: { spawn: [{ x: 1, y: 1 }] },
});

it('полная сетка', () => {
  expect(
    validateWorldIndex(
      index([
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]),
    ),
  ).toEqual([]);
  expect(chunkPath('dawn', 3, 4)).toBe('chunks/dawn/3_4.dmck');
});

it('пропущенный, лишний и повторный чанк', () => {
  expect(
    validateWorldIndex(
      index([
        [0, 0],
        [1, 0],
        [0, 1],
      ]),
    ),
  ).toEqual([expect.objectContaining({ code: 'WORLD_GRID', message: 'нет чанка (1, 1)' })]);
  const codes = validateWorldIndex(
    index([
      [0, 0],
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 0],
    ]),
  ).map((i) => i.code);
  expect(codes).toEqual(['WORLD_DUPLICATE', 'WORLD_GRID']);
});

it('размер не кратен 32 и ошибки схемы', () => {
  expect(validateWorldIndex(index([], 48)).map((i) => i.code)).toEqual(['WORLD_GRID']);
  expect(validateWorldIndex({ ...index([]), chunkSize: 16 }).map((i) => i.code)).toContain(
    'WORLD_SCHEMA',
  );
});
