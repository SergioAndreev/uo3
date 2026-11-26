import { SeededRng, SURFACES, CELL_FLAGS } from '@duskmarch/domain';
import { expect, it } from 'vitest';
import {
  CELLS_PER_CHUNK,
  ChunkFormatError,
  crc32,
  decodeChunk,
  emptyChunk,
  encodeChunk,
  readCell,
  toLocal,
  writeCell,
  type Chunk,
  type ChunkObject,
} from './index.js';

const rng = new SeededRng('chunk-tests');

function randomChunk(objects = rng.int(0, 40)): Chunk {
  const chunk = emptyChunk(rng.int(0, 255), rng.int(0, 127), rng.int(0, 127));
  for (let i = 0; i < CELLS_PER_CHUNK; i++) {
    chunk.surfaces[i] = rng.int(0, SURFACES.length - 1);
    chunk.tints[i] = rng.int(0, 255);
    chunk.heights[i] = rng.int(-1024, 1023);
    chunk.flags[i] = rng.int(0, (1 << CELL_FLAGS.length) - 1);
  }
  const keys = ['model.test-crate', 'model.test-tree', 'prop.test-wall'];
  for (let i = 0; i < objects; i++) {
    chunk.objects.push({
      key: rng.pick(keys),
      lx: rng.int(0, 31),
      ly: rng.int(0, 31),
      h: rng.int(-1024, 1023),
      rotation: rng.int(0, 3) as 0 | 1 | 2 | 3,
      tint: rng.int(0, 255),
      flags: rng.int(0, 1023),
    });
  }
  return chunk;
}

const sorted = (c: Chunk): Chunk => ({
  ...c,
  objects: [...c.objects].sort(
    (a, b) => a.ly - b.ly || a.lx - b.lx || a.h - b.h || a.key.localeCompare(b.key),
  ),
});

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof ChunkFormatError) return error.code;
    throw error;
  }
  return 'ok';
};

it('CRC-32 эталон', () => {
  expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
});

it('заголовок', () => {
  const bytes = encodeChunk(emptyChunk(0, 3, 5));
  expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('DMCK');
  expect([...bytes.subarray(10, 14)]).toEqual([3, 0, 5, 0]);
  expect(bytes.length).toBe(24 + 8192);
});

it('круговое кодирование и длина', () => {
  const chunk = randomChunk(0);
  const objects: ChunkObject[] = [
    { key: 'model.test-crate', lx: 1, ly: 2, h: 0, rotation: 1, tint: 3, flags: 0 },
    { key: 'model.test-tree', lx: 5, ly: 5, h: 4, rotation: 0, tint: 0, flags: 1 },
    { key: 'model.test-crate', lx: 9, ly: 0, h: -2, rotation: 3, tint: 9, flags: 2 },
  ];
  chunk.objects.push(...objects);
  const bytes = encodeChunk(chunk);
  expect(bytes.length).toBe(24 + 8192 + (1 + 16 + 1 + 15) + 30);
  expect(decodeChunk(bytes)).toEqual(sorted(chunk));
});

it('200 случайных чанков', () => {
  for (let i = 0; i < 200; i++) {
    const chunk = randomChunk();
    expect(decodeChunk(encodeChunk(chunk))).toEqual(sorted(chunk));
  }
});

it('порядок объектов не влияет на байты, лишних ключей нет', () => {
  const chunk = randomChunk(30);
  const shuffled = { ...chunk, objects: rng.shuffle([...chunk.objects]) };
  expect(encodeChunk(shuffled)).toEqual(encodeChunk(chunk));
  const one = emptyChunk(0, 0, 0);
  one.objects.push({ key: 'model.only', lx: 0, ly: 0, h: 0, rotation: 0, tint: 0, flags: 0 });
  const bytes = encodeChunk(one);
  expect(new DataView(bytes.buffer).getUint16(14, true)).toBe(1);
});

it('коды ошибок декодера', () => {
  const good = encodeChunk(randomChunk(5));
  const patch = (offset: number, value: number) => {
    const copy = good.slice();
    copy[offset] = value;
    return copy;
  };
  expect(code(() => decodeChunk(patch(0, 0x58)))).toBe('CHUNK_MAGIC');
  expect(code(() => decodeChunk(patch(4, 2)))).toBe('CHUNK_VERSION');
  expect(code(() => decodeChunk(patch(6, 1)))).toBe('CHUNK_VERSION');
  expect(code(() => decodeChunk(patch(9, 1)))).toBe('CHUNK_VALUE');
  expect(code(() => decodeChunk(patch(100, (good[100] ?? 0) ^ 0xff)))).toBe('CHUNK_CRC');
  expect(code(() => decodeChunk(good.subarray(0, 10)))).toBe('CHUNK_TRUNCATED');
  let error: unknown;
  try {
    decodeChunk(good.subarray(0, 100));
  } catch (e) {
    error = e;
  }
  expect(error).toMatchObject({ code: 'CHUNK_TRUNCATED', offset: 100 });
  const longer = new Uint8Array(good.length + 1);
  longer.set(good);
  expect(code(() => decodeChunk(longer))).toBe('CHUNK_VALUE');
});

it('значения вне диапазона отклоняются при кодировании и декодировании', () => {
  const bad = emptyChunk(0, 0, 0);
  bad.surfaces[0] = SURFACES.length;
  expect(code(() => encodeChunk(bad))).toBe('CHUNK_VALUE');
  const flags = emptyChunk(0, 0, 0);
  flags.flags[5] = 1 << 20;
  expect(code(() => encodeChunk(flags))).toBe('CHUNK_VALUE');
  const obj = (o: Partial<ChunkObject>) => {
    const c = emptyChunk(0, 0, 0);
    c.objects.push({ key: 'model.a', lx: 0, ly: 0, h: 0, rotation: 0, tint: 0, flags: 0, ...o });
    return code(() => encodeChunk(c));
  };
  for (const o of [
    { lx: 32 },
    { ly: -1 },
    { h: 2000 },
    { rotation: 4 as 0 },
    { tint: 256 },
    { flags: 1 << 12 },
    { key: 'Bad' },
  ]) {
    expect(obj(o), JSON.stringify(o)).toBe('CHUNK_VALUE');
  }
  // Подмена значения с пересчётом CRC доходит до проверки значений.
  const bytes = encodeChunk(emptyChunk(0, 0, 0));
  bytes[24] = 200;
  new DataView(bytes.buffer).setUint32(20, crc32(bytes, 24), true);
  expect(code(() => decodeChunk(bytes))).toBe('CHUNK_VALUE');
});

it('порча любого байта даёт только ChunkFormatError', () => {
  for (let n = 0; n < 10; n++) {
    const good = encodeChunk(randomChunk(4));
    for (let i = 0; i < good.length; i += 7) {
      const copy = good.slice();
      copy[i] = (copy[i] ?? 0) ^ 0x5a;
      expect(code(() => decodeChunk(copy))).not.toBe('ok');
    }
  }
});

it('доступ к клеткам', () => {
  expect(toLocal({ x: 70, y: 33 })).toEqual({ cx: 2, cy: 1, lx: 6, ly: 1 });
  const chunk = emptyChunk(0, 0, 0);
  writeCell(chunk, 31, 31, { surface: 3, h: -5, flags: 4, tint: 7 });
  writeCell(chunk, 0, 0, { h: 2 });
  expect(readCell(chunk, 31, 31)).toEqual({ surface: 3, tint: 7, h: -5, flags: 4 });
  expect(readCell(chunk, 0, 0).h).toBe(2);
  expect(() => readCell(chunk, 32, 0)).toThrow(RangeError);
});
