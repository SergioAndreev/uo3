import { flagBit } from '@duskmarch/domain';
import type { RealmStore } from './store.js';

const BLOCKS_SIGHT = flagBit('blocks-sight');

export interface SightPoint {
  x: number;
  y: number;
  /** Высота опоры, шаги. */
  h: number;
  realm?: number;
}
export interface SightOptions {
  /** Высота глаз над опорой источника (по умолчанию 6 шагов). */
  fromEye?: number;
  /** Высота точки над опорой цели (по умолчанию 6 шагов). */
  toEye?: number;
  /** Дальность по Чебышёву (по умолчанию 20). */
  range?: number;
  trace?: boolean;
  /** Динамические препятствия клетки (предметы и постройки партиции P06). */
  dynamic?: (x: number, y: number) => Iterable<DynamicObstacle>;
}

/** Препятствие, которого нет в чанках: `base`/`top` — высоты в шагах. */
export interface DynamicObstacle {
  base: number;
  top: number;
  blocksSight: boolean;
}
export type SightBlock = 'cell' | 'object' | 'terrain' | 'corner' | 'dynamic';
export interface TraceStep {
  x: number;
  y: number;
  /** Высота луча в шагах (для отладки, с плавающей точкой). */
  rayH: number;
}
export interface SightResult {
  visible: boolean;
  reason?: 'range' | 'realm' | SightBlock;
  blockedAt?: { x: number; y: number };
  trace?: TraceStep[];
}

/**
 * Высота луча в точке `t = n / d` сравнивается в целых: `e0·d + (e1 − e0)·n` против `k·d`.
 * Прямой и обратный обход дают одни и те же клетки и значения (design P03 D5).
 */
function blockAt(
  store: RealmStore,
  x: number,
  y: number,
  value: number,
  denom: number,
  dynamic?: SightOptions['dynamic'],
): SightBlock | undefined {
  const cell = store.cell(x, y);
  if (!cell) return 'cell';
  if ((cell.flags & BLOCKS_SIGHT) !== 0) return 'cell';
  if (value < cell.h * denom) return 'terrain';
  for (const o of store.objectsAt(x, y)) {
    if (o.blocksSight && o.base * denom <= value && value < o.top * denom) return 'object';
  }
  if (dynamic) {
    for (const o of dynamic(x, y)) {
      if (o.blocksSight && o.base * denom <= value && value < o.top * denom) return 'dynamic';
    }
  }
  return undefined;
}

export function lineOfSight(
  store: RealmStore,
  from: SightPoint,
  to: SightPoint,
  options: SightOptions = {},
): SightResult {
  if (
    (from.realm ?? store.realm.id) !== store.realm.id ||
    (to.realm ?? store.realm.id) !== store.realm.id
  ) {
    return { visible: false, reason: 'realm' };
  }
  const range = options.range ?? 20;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) > range) return { visible: false, reason: 'range' };
  const e0 = from.h + (options.fromEye ?? 6);
  const e1 = to.h + (options.toEye ?? 6);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const A = Math.max(ax, 1);
  const B = Math.max(ay, 1);
  const M = 4 * A * B;
  const D = 2 * M;
  const height = (twiceN: number): number => e0 * D + (e1 - e0) * twiceN;
  const trace: TraceStep[] | undefined = options.trace ? [] : undefined;
  const done = (reason?: SightBlock, at?: { x: number; y: number }): SightResult => ({
    visible: reason === undefined,
    ...(reason ? { reason } : {}),
    ...(at ? { blockedAt: at } : {}),
    ...(trace ? { trace } : {}),
  });
  let cx = from.x;
  let cy = from.y;
  let i = 0;
  let j = 0;
  let enter = 0;
  while (i < ax || j < ay) {
    const nx = i < ax ? (2 * i + 1) * 2 * B : Infinity;
    const ny = j < ay ? (2 * j + 1) * 2 * A : Infinity;
    if (nx === ny) {
      // Точный проход через угол: блокирует, только если закрыты обе ортогональные клетки.
      const value = height(2 * nx);
      const a = blockAt(store, cx + sx, cy, value, D, options.dynamic);
      const b = blockAt(store, cx, cy + sy, value, D, options.dynamic);
      if (a && b) return done('corner', { x: cx + sx, y: cy });
      cx += sx;
      cy += sy;
      i++;
      j++;
    } else if (nx < ny) {
      cx += sx;
      i++;
    } else {
      cy += sy;
      j++;
    }
    enter = Math.min(nx, ny);
    if (cx === to.x && cy === to.y) break;
    const nextX = i < ax ? (2 * i + 1) * 2 * B : M;
    const nextY = j < ay ? (2 * j + 1) * 2 * A : M;
    const exit = Math.min(nextX, nextY, M);
    const value = height(enter + exit);
    trace?.push({ x: cx, y: cy, rayH: value / D });
    const reason = blockAt(store, cx, cy, value, D, options.dynamic);
    if (reason) return done(reason, { x: cx, y: cy });
  }
  return done();
}
