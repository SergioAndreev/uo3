import { expect, it } from 'vitest';
import { isDomainError, type DomainErrorCode } from '../errors/index.js';
import {
  BUILTIN_REALMS,
  DAWN,
  DIRECTIONS,
  DUSK,
  PROVING,
  RealmRegistry,
  area,
  areaContains,
  canClimb,
  cell,
  chebyshev,
  chunkOf,
  directionTo,
  distance,
  euclideanSquared,
  fitsUnder,
  gridBounds,
  isDirection,
  manhattan,
  offset,
  opposite,
  position,
  sectorOf,
  sectorsInRange,
  stepOffset,
  toScene,
  toScreenDirection,
  toWorldDirection,
  withinRange,
  type CameraRotation,
} from './index.js';

const fails = (fn: () => unknown, code: DomainErrorCode): void => {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(isDomainError(caught, code), String(caught)).toBe(true);
};

it('позиции: граничные высоты и координаты', () => {
  expect(position(DAWN, 0, 0, -1024).h).toBe(-1024);
  expect(position(DAWN, 0, 0, 1023).h).toBe(1023);
  fails(() => position(DAWN, 0, 0, 1024), 'ERR_HEIGHT_OUT_OF_RANGE');
  fails(() => position(DAWN, 0, 0, 0.5), 'ERR_HEIGHT_OUT_OF_RANGE');
  for (const x of [-1, 1.5, 65_536, Number.NaN]) fails(() => cell(x, 0), 'ERR_INVALID_COORDINATE');
  fails(() => position(256, 0, 0), 'ERR_INVALID_COORDINATE');
  expect(offset(position(DAWN, 5, 5, 1), 1, -1, 2)).toEqual({ realm: DAWN, x: 6, y: 4, h: 3 });
});

it('позиции неизменяемы', () => {
  const p = position(DAWN, 1, 2);
  expect(() => {
    (p as { x: number }).x = 5;
  }).toThrow(TypeError);
  expect(p.x).toBe(1);
});

it('области', () => {
  const a = area(10, 10, 4, 2);
  expect(areaContains(a, cell(13, 11))).toBe(true);
  expect(areaContains(a, cell(14, 11))).toBe(false);
  fails(() => area(0, 0, -1, 1), 'ERR_INVALID_COORDINATE');
});

it('реестр планов', () => {
  const realms = new RealmRegistry();
  expect(realms.contains(DAWN, cell(4095, 4095))).toBe(true);
  fails(() => realms.assertInside(DAWN, cell(4096, 0)), 'ERR_OUT_OF_REALM_BOUNDS');
  expect(realms.get(PROVING)).toMatchObject({
    key: 'proving',
    width: 64,
    height: 64,
    testOnly: true,
  });
  expect(realms.get(DUSK).pvp).toBe('open');
  fails(() => realms.get(7), 'ERR_UNKNOWN_REALM');
  realms.register({
    id: 7,
    key: 'rift',
    name: 'Разлом',
    width: 8,
    height: 8,
    pvp: 'open',
    testOnly: true,
  });
  expect(realms.list().map((r) => r.key)).toEqual(['dawn', 'dusk', 'proving', 'rift']);
  fails(() => realms.register(BUILTIN_REALMS[0]!), 'ERR_UNKNOWN_REALM');
});

it('сектора и чанки', () => {
  expect(sectorOf(cell(40, 70))).toEqual({ gx: 2, gy: 4 });
  expect(chunkOf(cell(40, 70))).toEqual({ gx: 1, gy: 2 });
  expect(gridBounds({ gx: 2, gy: 4 }, 16)).toEqual({
    min: { x: 32, y: 64 },
    max: { x: 47, y: 79 },
  });
  const keys = sectorsInRange(new RealmRegistry().get(DAWN), cell(100, 100), 20);
  expect(keys).toHaveLength(9);
  expect(keys[0]).toEqual({ gx: 5, gy: 5 });
  expect(keys[8]).toEqual({ gx: 7, gy: 7 });
});

it('сектора обрезаются границей плана', () => {
  const proving = new RealmRegistry().get(PROVING);
  expect(sectorsInRange(proving, cell(0, 0), 20)).toEqual([
    { gx: 0, gy: 0 },
    { gx: 1, gy: 0 },
    { gx: 0, gy: 1 },
    { gx: 1, gy: 1 },
  ]);
  expect(sectorsInRange(proving, cell(63, 63), 100)).toHaveLength(16);
});

it('направления к цели', () => {
  expect(directionTo(cell(10, 10), cell(13, 7))).toBe(1);
  expect(directionTo(cell(10, 10), cell(10, 15))).toBe(4);
  expect(directionTo(cell(10, 10), cell(10, 10), 6)).toBe(6);
  expect(stepOffset(5)).toEqual({ dx: -1, dy: 1 });
  expect(opposite(1)).toBe(5);
  expect(isDirection(8)).toBe(false);
});

it('направление совпадает с сектором угла для квадрата 9×9', () => {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      if (dx === 0 && dy === 0) continue;
      // Угол от севера по часовой стрелке; ось y направлена на юг.
      const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
      const expected = Math.round(((angle + 360) % 360) / 45) % 8;
      expect(directionTo(cell(10, 10), cell(10 + dx, 10 + dy)), `${dx},${dy}`).toBe(expected);
    }
  }
});

it('смещение шага ведёт в соседнюю клетку того же направления', () => {
  for (const d of DIRECTIONS) {
    const { dx, dy } = stepOffset(d);
    expect(directionTo(cell(5, 5), cell(5 + dx, 5 + dy))).toBe(d);
  }
});

it('метрики расстояний', () => {
  expect(chebyshev(cell(0, 0), cell(3, 4))).toBe(4);
  expect(euclideanSquared(cell(0, 0), cell(3, 4))).toBe(25);
  expect(manhattan(cell(0, 0), cell(3, 4))).toBe(7);
  expect(withinRange(position(DAWN, 0, 0), position(DAWN, 3, 4), 4)).toBe(true);
  expect(withinRange(position(DAWN, 0, 0), position(DAWN, 3, 5), 4)).toBe(false);
  fails(() => distance(position(DAWN, 0, 0), position(DUSK, 0, 0)), 'ERR_REALM_MISMATCH');
});

it('повороты камеры', () => {
  expect(toScreenDirection(2, 1)).toBe(0);
  expect(toWorldDirection(0, 1)).toBe(2);
  for (const rotation of [0, 1, 2, 3] as CameraRotation[]) {
    for (const d of DIRECTIONS)
      expect(toWorldDirection(toScreenDirection(d, rotation), rotation)).toBe(d);
  }
  expect(toScene(position(DAWN, 10, 20, 6))).toEqual({ x: 10.5, y: 1.5, z: 20.5 });
});

it('зазоры', () => {
  expect(canClimb(0, 2)).toBe(true);
  expect(canClimb(0, 3)).toBe(false);
  expect(canClimb(5, -20)).toBe(true);
  expect(fitsUnder(0, 6)).toBe(false);
  expect(fitsUnder(0, 7)).toBe(true);
});
