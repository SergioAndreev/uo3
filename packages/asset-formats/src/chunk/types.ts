import { CHUNK_SIZE } from '@duskmarch/domain';

export const CELLS_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE;
export const MAX_OBJECTS = 4_096;
export type Rotation = 0 | 1 | 2 | 3;

export interface ChunkObject {
  /** Ключ контента модели. */
  key: string;
  lx: number;
  ly: number;
  h: number;
  rotation: Rotation;
  tint: number;
  /** Флаги клетки, которые объект добавляет (биты `CELL_FLAGS`). */
  flags: number;
}

/** Структура массивов: индекс клетки `ly * 32 + lx`. */
export interface Chunk {
  realm: number;
  cx: number;
  cy: number;
  surfaces: Uint8Array;
  tints: Uint8Array;
  heights: Int16Array;
  flags: Uint32Array;
  objects: ChunkObject[];
}

export const emptyChunk = (realm: number, cx: number, cy: number): Chunk => ({
  realm,
  cx,
  cy,
  surfaces: new Uint8Array(CELLS_PER_CHUNK),
  tints: new Uint8Array(CELLS_PER_CHUNK),
  heights: new Int16Array(CELLS_PER_CHUNK),
  flags: new Uint32Array(CELLS_PER_CHUNK),
  objects: [],
});

export type ChunkErrorCode =
  'CHUNK_MAGIC' | 'CHUNK_VERSION' | 'CHUNK_TRUNCATED' | 'CHUNK_CRC' | 'CHUNK_VALUE';

export class ChunkFormatError extends Error {
  override readonly name = 'ChunkFormatError';
  constructor(
    readonly code: ChunkErrorCode,
    readonly offset: number,
    message: string,
  ) {
    super(`${code} @${offset}: ${message}`);
  }
}
