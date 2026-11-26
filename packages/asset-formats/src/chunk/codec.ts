import {
  CHUNK_SIZE,
  CONTENT_KEY_PATTERN,
  KNOWN_FLAGS_MASK,
  MAX_HEIGHT,
  MIN_HEIGHT,
  SURFACES,
} from '@duskmarch/domain';
import { crc32 } from '../util/crc32.js';
import {
  CELLS_PER_CHUNK,
  ChunkFormatError,
  MAX_OBJECTS,
  type Chunk,
  type ChunkObject,
  type Rotation,
} from './types.js';

export const CHUNK_MAGIC = 'DMCK';
export const CHUNK_VERSION = 1;
export const HEADER_BYTES = 24;
export const CELL_BYTES = 8;
export const OBJECT_BYTES = 10;
const CELLS_BYTES = CELLS_PER_CHUNK * CELL_BYTES;

const compareObjects = (a: ChunkObject, b: ChunkObject): number =>
  a.ly - b.ly || a.lx - b.lx || a.h - b.h || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

const fail = (
  code: ConstructorParameters<typeof ChunkFormatError>[0],
  offset: number,
  message: string,
): never => {
  throw new ChunkFormatError(code, offset, message);
};

function checkObject(o: ChunkObject, offset: number): void {
  const inChunk = (v: number): boolean => Number.isInteger(v) && v >= 0 && v < CHUNK_SIZE;
  if (!inChunk(o.lx) || !inChunk(o.ly))
    fail('CHUNK_VALUE', offset, `объект вне чанка (${o.lx}, ${o.ly})`);
  if (!Number.isInteger(o.h) || o.h < MIN_HEIGHT || o.h > MAX_HEIGHT)
    fail('CHUNK_VALUE', offset, `высота ${o.h}`);
  if (![0, 1, 2, 3].includes(o.rotation)) fail('CHUNK_VALUE', offset, `поворот ${o.rotation}`);
  if (!Number.isInteger(o.tint) || o.tint < 0 || o.tint > 255)
    fail('CHUNK_VALUE', offset, `оттенок ${o.tint}`);
  if (!Number.isInteger(o.flags) || o.flags < 0 || (o.flags & ~KNOWN_FLAGS_MASK) !== 0) {
    fail('CHUNK_VALUE', offset, `флаги объекта 0x${o.flags.toString(16)}`);
  }
  if (!CONTENT_KEY_PATTERN.test(o.key) || o.key.length > 255)
    fail('CHUNK_VALUE', offset, `ключ «${o.key}»`);
}

function checkCell(chunk: Chunk, i: number, offset: number): void {
  if ((chunk.surfaces[i] ?? 0) >= SURFACES.length)
    fail('CHUNK_VALUE', offset, `поверхность ${chunk.surfaces[i]}`);
  const h = chunk.heights[i] ?? 0;
  if (h < MIN_HEIGHT || h > MAX_HEIGHT) fail('CHUNK_VALUE', offset + 2, `высота ${h}`);
  if (((chunk.flags[i] ?? 0) & ~KNOWN_FLAGS_MASK) !== 0)
    fail('CHUNK_VALUE', offset + 4, 'резервные биты флагов');
}

/** Каноническое кодирование: одинаковые чанки — одинаковые байты. */
export function encodeChunk(chunk: Chunk): Uint8Array {
  const objects = [...chunk.objects].sort(compareObjects);
  if (objects.length > MAX_OBJECTS)
    fail('CHUNK_VALUE', 0, `объектов ${objects.length} > ${MAX_OBJECTS}`);
  objects.forEach((o, i) => checkObject(o, i));
  for (let i = 0; i < CELLS_PER_CHUNK; i++) checkCell(chunk, i, HEADER_BYTES + i * CELL_BYTES);
  const keys: string[] = [];
  for (const o of objects) if (!keys.includes(o.key)) keys.push(o.key);
  const keyBytes = keys.reduce((sum, k) => sum + 1 + k.length, 0);
  const out = new Uint8Array(HEADER_BYTES + CELLS_BYTES + keyBytes + objects.length * OBJECT_BYTES);
  const v = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = CHUNK_MAGIC.charCodeAt(i);
  v.setUint16(4, CHUNK_VERSION, true);
  v.setUint16(6, 0, true);
  v.setUint8(8, chunk.realm);
  v.setUint16(10, chunk.cx, true);
  v.setUint16(12, chunk.cy, true);
  v.setUint16(14, keys.length, true);
  v.setUint16(16, objects.length, true);
  let p = HEADER_BYTES;
  for (let i = 0; i < CELLS_PER_CHUNK; i++, p += CELL_BYTES) {
    v.setUint8(p, chunk.surfaces[i] ?? 0);
    v.setUint8(p + 1, chunk.tints[i] ?? 0);
    v.setInt16(p + 2, chunk.heights[i] ?? 0, true);
    v.setUint32(p + 4, chunk.flags[i] ?? 0, true);
  }
  for (const key of keys) {
    out[p++] = key.length;
    for (let i = 0; i < key.length; i++) out[p++] = key.charCodeAt(i);
  }
  for (const o of objects) {
    v.setUint16(p, keys.indexOf(o.key), true);
    v.setUint8(p + 2, o.lx);
    v.setUint8(p + 3, o.ly);
    v.setInt16(p + 4, o.h, true);
    v.setUint8(p + 6, o.rotation);
    v.setUint8(p + 7, o.tint);
    v.setUint16(p + 8, o.flags, true);
    p += OBJECT_BYTES;
  }
  v.setUint32(20, crc32(out, HEADER_BYTES), true);
  return out;
}

/** Строгое декодирование; любое нарушение — `ChunkFormatError` с кодом и смещением. */
export function decodeChunk(bytes: Uint8Array): Chunk {
  const need = (end: number, what: string): void => {
    if (bytes.length < end) fail('CHUNK_TRUNCATED', bytes.length, `нет данных: ${what}`);
  };
  need(HEADER_BYTES, 'заголовок');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== CHUNK_MAGIC.charCodeAt(i)) fail('CHUNK_MAGIC', i, 'ожидалась магия DMCK');
  }
  const version = v.getUint16(4, true);
  if (version !== CHUNK_VERSION) fail('CHUNK_VERSION', 4, `версия ${version} не поддерживается`);
  if (v.getUint16(6, true) !== 0)
    fail('CHUNK_VERSION', 6, 'флаги заголовка версии 1 должны быть 0');
  if (v.getUint8(9) !== 0 || v.getUint16(18, true) !== 0)
    fail('CHUNK_VALUE', 9, 'резервные поля не нулевые');
  const keyCount = v.getUint16(14, true);
  const objectCount = v.getUint16(16, true);
  if (objectCount > MAX_OBJECTS) fail('CHUNK_VALUE', 16, `объектов ${objectCount}`);
  need(HEADER_BYTES + CELLS_BYTES, 'клетки');
  const chunk: Chunk = {
    realm: v.getUint8(8),
    cx: v.getUint16(10, true),
    cy: v.getUint16(12, true),
    surfaces: new Uint8Array(CELLS_PER_CHUNK),
    tints: new Uint8Array(CELLS_PER_CHUNK),
    heights: new Int16Array(CELLS_PER_CHUNK),
    flags: new Uint32Array(CELLS_PER_CHUNK),
    objects: [],
  };
  let p = HEADER_BYTES;
  const keys: string[] = [];
  // Длины проверяются до CRC, чтобы точно сообщить место обрезки.
  let q = HEADER_BYTES + CELLS_BYTES;
  for (let i = 0; i < keyCount; i++) {
    need(q + 1, 'длина ключа');
    const len = bytes[q] ?? 0;
    need(q + 1 + len, 'ключ');
    keys.push(String.fromCharCode(...bytes.subarray(q + 1, q + 1 + len)));
    q += 1 + len;
  }
  need(q + objectCount * OBJECT_BYTES, 'объекты');
  if (bytes.length !== q + objectCount * OBJECT_BYTES)
    fail('CHUNK_VALUE', q + objectCount * OBJECT_BYTES, 'лишние байты');
  const stored = v.getUint32(20, true);
  if (crc32(bytes, HEADER_BYTES) !== stored)
    fail('CHUNK_CRC', 20, 'контрольная сумма не совпадает');
  for (let i = 0; i < CELLS_PER_CHUNK; i++, p += CELL_BYTES) {
    chunk.surfaces[i] = v.getUint8(p);
    chunk.tints[i] = v.getUint8(p + 1);
    chunk.heights[i] = v.getInt16(p + 2, true);
    chunk.flags[i] = v.getUint32(p + 4, true);
    checkCell(chunk, i, p);
  }
  keys.forEach((key, i) => {
    if (!CONTENT_KEY_PATTERN.test(key))
      fail('CHUNK_VALUE', HEADER_BYTES + CELLS_BYTES, `ключ ${i} «${key}»`);
  });
  for (let i = 0; i < objectCount; i++, q += OBJECT_BYTES) {
    const index = v.getUint16(q, true);
    const key = keys[index];
    if (key === undefined) fail('CHUNK_VALUE', q, `индекс ключа ${index}`);
    const o: ChunkObject = {
      key: key as string,
      lx: v.getUint8(q + 2),
      ly: v.getUint8(q + 3),
      h: v.getInt16(q + 4, true),
      rotation: v.getUint8(q + 6) as Rotation,
      tint: v.getUint8(q + 7),
      flags: v.getUint16(q + 8, true),
    };
    checkObject(o, q);
    chunk.objects.push(o);
  }
  return chunk;
}
