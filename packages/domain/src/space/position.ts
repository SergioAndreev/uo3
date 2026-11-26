import { DomainError } from '../errors/index.js';

export type RealmId = number;
export interface Cell {
  readonly x: number;
  readonly y: number;
}
export interface Position extends Cell {
  readonly realm: RealmId;
  /** Высота в шагах по 0,25 м. */
  readonly h: number;
}
/** Прямоугольник клеток `[x, x + width) × [y, y + height)`. */
export interface Area extends Cell {
  readonly width: number;
  readonly height: number;
}

export const MAX_COORD = 65_535;
export const MIN_HEIGHT = -1_024;
export const MAX_HEIGHT = 1_023;
export const HEIGHT_STEP_M = 0.25;

const coord = (name: string, value: number, max = MAX_COORD): number => {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new DomainError('ERR_INVALID_COORDINATE', `${name} = ${value} вне 0..${max}`, {
      fieldPath: name,
    });
  }
  return value;
};

export const checkHeight = (h: number): number => {
  if (!Number.isInteger(h) || h < MIN_HEIGHT || h > MAX_HEIGHT) {
    throw new DomainError('ERR_HEIGHT_OUT_OF_RANGE', `h = ${h} вне ${MIN_HEIGHT}..${MAX_HEIGHT}`, {
      fieldPath: 'h',
    });
  }
  return h;
};

export const cell = (x: number, y: number): Cell =>
  Object.freeze({ x: coord('x', x), y: coord('y', y) });

export const position = (realm: RealmId, x: number, y: number, h = 0): Position =>
  Object.freeze({
    realm: coord('realm', realm, 255),
    x: coord('x', x),
    y: coord('y', y),
    h: checkHeight(h),
  });

export const area = (x: number, y: number, width: number, height: number): Area => {
  coord('width', width);
  coord('height', height);
  return Object.freeze({ x: coord('x', x), y: coord('y', y), width, height });
};

export const areaContains = (a: Area, c: Cell): boolean =>
  c.x >= a.x && c.x < a.x + a.width && c.y >= a.y && c.y < a.y + a.height;

export const offset = (p: Position, dx: number, dy: number, dh = 0): Position =>
  position(p.realm, p.x + dx, p.y + dy, p.h + dh);
