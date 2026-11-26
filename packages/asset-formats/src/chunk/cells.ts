import { CHUNK_SIZE, type Cell } from '@duskmarch/domain';
import type { Chunk } from './types.js';

export interface LocalCell {
  cx: number;
  cy: number;
  lx: number;
  ly: number;
}

/** Мировая клетка → чанк и локальная клетка, целочисленно. */
export const toLocal = ({ x, y }: Cell): LocalCell => ({
  cx: Math.floor(x / CHUNK_SIZE),
  cy: Math.floor(y / CHUNK_SIZE),
  lx: x % CHUNK_SIZE,
  ly: y % CHUNK_SIZE,
});

export const cellIndex = (lx: number, ly: number): number => {
  if (
    !Number.isInteger(lx) ||
    !Number.isInteger(ly) ||
    lx < 0 ||
    ly < 0 ||
    lx >= CHUNK_SIZE ||
    ly >= CHUNK_SIZE
  ) {
    throw new RangeError(`клетка (${lx}, ${ly}) вне чанка`);
  }
  return ly * CHUNK_SIZE + lx;
};

export interface CellData {
  surface: number;
  tint: number;
  h: number;
  flags: number;
}

export function readCell(chunk: Chunk, lx: number, ly: number): CellData {
  const i = cellIndex(lx, ly);
  return {
    surface: chunk.surfaces[i] ?? 0,
    tint: chunk.tints[i] ?? 0,
    h: chunk.heights[i] ?? 0,
    flags: chunk.flags[i] ?? 0,
  };
}

export function writeCell(chunk: Chunk, lx: number, ly: number, data: Partial<CellData>): void {
  const i = cellIndex(lx, ly);
  if (data.surface !== undefined) chunk.surfaces[i] = data.surface;
  if (data.tint !== undefined) chunk.tints[i] = data.tint;
  if (data.h !== undefined) chunk.heights[i] = data.h;
  if (data.flags !== undefined) chunk.flags[i] = data.flags;
}
