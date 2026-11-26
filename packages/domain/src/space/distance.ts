import { DomainError } from '../errors/index.js';
import type { Cell, Position } from './position.js';

export const chebyshev = (a: Cell, b: Cell): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const euclideanSquared = (a: Cell, b: Cell): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const manhattan = (a: Cell, b: Cell): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function sameRealm(a: Position, b: Position): void {
  if (a.realm !== b.realm) {
    throw new DomainError('ERR_REALM_MISMATCH', `планы ${a.realm} и ${b.realm} различаются`);
  }
}

/** Расстояние между позициями; разные планы — ошибка. */
export const distance = (a: Position, b: Position): number => {
  sameRealm(a, b);
  return chebyshev(a, b);
};

export const withinRange = (a: Position, b: Position, radius: number): boolean =>
  distance(a, b) <= radius;
