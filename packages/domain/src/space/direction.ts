import type { Cell } from './position.js';

/** 0 — север (−y), далее по часовой стрелке. */
export type Direction = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type MoveMode = 'walk' | 'run';
export const DIRECTIONS: readonly Direction[] = [0, 1, 2, 3, 4, 5, 6, 7];
export const DIRECTION_KEYS = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
] as const;

const DX = [0, 1, 1, 1, 0, -1, -1, -1] as const;
const DY = [-1, -1, 0, 1, 1, 1, 0, -1] as const;

export const isDirection = (value: unknown): value is Direction =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 7;

export const stepOffset = (d: Direction): { dx: number; dy: number } => ({ dx: DX[d], dy: DY[d] });

export const rotate = (d: Direction, steps: number): Direction =>
  ((((d + steps) % 8) + 8) % 8) as Direction;
export const opposite = (d: Direction): Direction => rotate(d, 4);

/**
/** Направление к цели по секторам ±22,5° без тригонометрии. */
export function directionTo(from: Cell, to: Cell, fallback: Direction = 0): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return fallback;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  // tan(22,5°) = √2 − 1 ≈ 0,4142; сравнение в целых: 1000·a ≤ 414·b.
  if (ay * 1000 <= ax * 414) return dx > 0 ? 2 : 6;
  if (ax * 1000 <= ay * 414) return dy > 0 ? 4 : 0;
  if (dx > 0) return dy > 0 ? 3 : 1;
  return dy > 0 ? 5 : 7;
}
