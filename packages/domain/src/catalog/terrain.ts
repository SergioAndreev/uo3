import { DomainError } from '../errors/index.js';

export const FRAMES = ['humanoid', 'beast', 'avian', 'aquatic', 'construct', 'wisp'] as const;
export type Frame = (typeof FRAMES)[number];

export const SURFACES = [
  'soil',
  'grass',
  'sand',
  'stone',
  'snow',
  'ice',
  'ash',
  'moss',
  'shallow-water',
  'deep-water',
  'void',
] as const;
export type Surface = (typeof SURFACES)[number];

export const CELL_FLAGS = [
  'impassable',
  'blocks-sight',
  'standable',
  'water',
  'deep',
  'climbable',
  'roof',
  'door',
  'hazard',
  'shelter',
] as const;
export type CellFlag = (typeof CELL_FLAGS)[number];
export type CellFlags = number & { readonly __cellFlags: true };

export const KNOWN_FLAGS_MASK = (1 << CELL_FLAGS.length) - 1;
export const flagBit = (flag: CellFlag): number => 1 << CELL_FLAGS.indexOf(flag);
export const NO_FLAGS = 0 as CellFlags;

export const withFlags = (mask: CellFlags, ...flags: CellFlag[]): CellFlags =>
  (flags.reduce<number>((acc, flag) => acc | flagBit(flag), mask) >>> 0) as CellFlags;
export const withoutFlags = (mask: CellFlags, ...flags: CellFlag[]): CellFlags =>
  (flags.reduce<number>((acc, flag) => acc & ~flagBit(flag), mask) >>> 0) as CellFlags;
export const hasFlag = (mask: CellFlags, flag: CellFlag): boolean => (mask & flagBit(flag)) !== 0;
export const listFlags = (mask: CellFlags): CellFlag[] =>
  CELL_FLAGS.filter((flag) => hasFlag(mask, flag));

/** Маска из данных: зарезервированные биты отклоняются. */
export function parseCellFlags(value: number): CellFlags {
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > 0xffffffff ||
    (value & ~KNOWN_FLAGS_MASK) !== 0
  ) {
    throw new DomainError(
      'ERR_UNKNOWN_CELL_FLAG',
      `маска 0x${value.toString(16)} содержит неизвестные биты`,
    );
  }
  return value as CellFlags;
}
