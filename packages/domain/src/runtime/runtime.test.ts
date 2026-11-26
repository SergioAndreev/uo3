import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { isDomainError } from '../errors/index.js';
import {
  DAWN_LIGHT,
  DUSK_LIGHT,
  SeededRng,
  SystemClock,
  fnv1a,
  formatGameTime,
  gameTime,
  lightLevel,
  lightPhase,
  splitmix32,
  tickOf,
  utf8,
} from './index.js';

const vectors = JSON.parse(
  readFileSync(new URL('./rng.vectors.json', import.meta.url), 'utf8'),
) as {
  seed20261126: { state: number[]; first1000: number[] };
  seedString: { seed: string; fnv1a: number; first16: number[] };
  seed0: { state: number[]; first16: number[] };
};

const fakeSources = () => {
  const s = { mono: 1_000, utc: 1_700_000_000_000 };
  return { s, sources: { monotonic: () => s.mono, utc: () => s.utc } };
};

it('UTF-8 совпадает с TextEncoder', () => {
  for (const text of ['', 'abc', 'Эйра', 'Ладь·Кремнёв', '𝄞 нота', '\u07ff\u0800']) {
    expect(utf8(text)).toEqual([...new TextEncoder().encode(text)]);
  }
});

it('номер тика', () => {
  expect([49, 50, 99, 10_000].map((ms) => tickOf(ms))).toEqual([0, 1, 1, 200]);
});

it('системные часы: чтения внутри тика одинаковы', () => {
  const { s, sources } = fakeSources();
  const clock = new SystemClock({ sources });
  for (let i = 0; i < 200; i++) {
    s.mono += 50;
    clock.capture();
  }
  s.mono += 7;
  const reads = Array.from({ length: 5 }, () => clock.now());
  expect(reads).toEqual([10_000, 10_000, 10_000, 10_000, 10_000]);
  expect(clock.tick()).toBe(200);
});

it('системные часы: перевод UTC назад не влияет', () => {
  const { s, sources } = fakeSources();
  const clock = new SystemClock({ sources });
  s.mono += 120;
  s.utc -= 60_000;
  expect(clock.capture()).toBe(120);
  expect(clock.utc()).toBe(1_700_000_000_000 - 60_000);
});

it('системные часы: длительная пауза ограничивается', () => {
  const { s, sources } = fakeSources();
  const drift: number[] = [];
  const clock = new SystemClock({ sources, onDrift: (e) => drift.push(e.droppedMs) });
  s.mono += 1_200;
  expect(clock.capture()).toBe(250);
  expect(drift).toEqual([950]);
  s.mono -= 10;
  expect(clock.capture()).toBe(250);
});

it('системные часы по умолчанию читают реальное время', () => {
  const clock = new SystemClock();
  expect(clock.capture()).toBeGreaterThanOrEqual(0);
  expect(clock.utc()).toBeGreaterThan(0);
  expect(clock.tickMs).toBe(50);
});

it('ГПСЧ совпадает с независимым эталоном', () => {
  expect(splitmix32(20261126)).toEqual(vectors.seed20261126.state);
  const a = new SeededRng(20261126);
  const b = new SeededRng(20261126);
  const seq = Array.from({ length: 1000 }, () => a.next());
  expect(seq).toEqual(vectors.seed20261126.first1000);
  expect(Array.from({ length: 1000 }, () => b.next())).toEqual(seq);
  expect(fnv1a(vectors.seedString.seed)).toBe(vectors.seedString.fnv1a);
  const named = new SeededRng(vectors.seedString.seed);
  expect(Array.from({ length: 16 }, () => named.next())).toEqual(vectors.seedString.first16);
  const zero = new SeededRng(0);
  expect(Array.from({ length: 16 }, () => zero.next())).toEqual(vectors.seed0.first16);
});

it('целые без смещения', () => {
  const rng = new SeededRng(7);
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 600_000; i++) counts[rng.int(0, 5)]!++;
  for (const count of counts) {
    expect(count).toBeGreaterThanOrEqual(99_000);
    expect(count).toBeLessThanOrEqual(101_000);
  }
  expect(() => rng.int(5, 4)).toThrow(RangeError);
  expect(() => rng.int(0, 0x1_0000_0000)).toThrow(RangeError);
  expect(rng.int(3, 3)).toBe(3);
  const f = rng.float();
  expect(f >= 0 && f < 1).toBe(true);
});

it('отбраковка срабатывает у неудобного диапазона', () => {
  const rng = new SeededRng(1);
  // Диапазон 3·2^30: отбрасывается четверть значений.
  for (let i = 0; i < 1000; i++) {
    const value = rng.int(0, 3 * 2 ** 30 - 1);
    expect(value).toBeLessThan(3 * 2 ** 30);
  }
});

it('броски костей', () => {
  const rng = new SeededRng(99);
  for (let i = 0; i < 1000; i++) {
    const value = rng.roll('3d6+2');
    expect(value).toBeGreaterThanOrEqual(5);
    expect(value).toBeLessThanOrEqual(20);
  }
  expect(rng.roll('1d2-5')).toBeLessThanOrEqual(-3);
  for (const bad of ['d6', '0d6', '101d6', '2d1', '2d1001', '2d6+', 'abc', '2D6']) {
    let caught: unknown;
    try {
      rng.roll(bad);
    } catch (error) {
      caught = error;
    }
    expect(isDomainError(caught, 'ERR_INVALID_DICE'), bad).toBe(true);
  }
});

it('веса, выбор и перемешивание', () => {
  const rng = new SeededRng('loot');
  const counts = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 40_000; i++) {
    counts[
      rng.weighted([
        { value: 'a' as const, weight: 1 },
        { value: 'b' as const, weight: 3 },
        { value: 'c' as const, weight: 0 },
      ])
    ]++;
  }
  expect(counts.c).toBe(0);
  expect(counts.b / counts.a).toBeGreaterThan(2.8);
  expect(counts.b / counts.a).toBeLessThan(3.2);
  expect(() => rng.weighted([{ value: 1, weight: 0 }])).toThrow(RangeError);
  expect(() => rng.weighted([{ value: 1, weight: 1.5 }])).toThrow(RangeError);
  expect(() => rng.pick([])).toThrow(RangeError);
  expect([1, 2, 3]).toContain(rng.pick([1, 2, 3]));
  expect(rng.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  expect(typeof rng.chance(1, 2)).toBe('boolean');
});

it('ветвление не сдвигает родителя и даёт независимые потоки', () => {
  const a = new SeededRng(5);
  const b = new SeededRng(5);
  const loot = a.fork('loot');
  expect(a.next()).toBe(b.next());
  const spawn = new SeededRng(5).fork('spawn');
  expect(loot.next()).not.toBe(spawn.next());
  expect(new SeededRng(5).fork('loot').next()).toBe(new SeededRng(5).fork('loot').next());
});

it('снимок и восстановление', () => {
  const rng = new SeededRng(42);
  for (let i = 0; i < 10; i++) rng.next();
  const snap = rng.snapshot();
  const after = Array.from({ length: 5 }, () => rng.next());
  const restored = SeededRng.restore(snap);
  expect(Array.from({ length: 5 }, () => restored.next())).toEqual(after);
  expect(Object.isFrozen(snap)).toBe(true);
  expect(new SeededRng([0, 0, 0, 0]).next()).not.toBe(0);
});

it('игровое время', () => {
  const t = gameTime(6_000_000);
  expect(t).toMatchObject({ day: 1, hour: 1, minute: 0 });
  expect(formatGameTime(t)).toBe('01:00');
  expect(gameTime(6_000_000, 0, 24_000)).toMatchObject({ day: 10, hour: 10 });
  expect(gameTime(100, 1_000)).toMatchObject({ day: 0, minuteOfDay: 0 });
  expect(formatGameTime(gameTime(240_000 * 13 + 4_000 * 7))).toBe('13:07');
});

it('фазы и уровень света', () => {
  expect([0, 179, 180, 539, 540, 899, 900, 1259, 1260, 1439].map(lightPhase)).toEqual([
    'ebb',
    'ebb',
    'rise',
    'rise',
    'crest',
    'crest',
    'fall',
    'fall',
    'ebb',
    'ebb',
  ]);
  expect(lightLevel(DAWN_LIGHT, 720)).toBe(85);
  expect(lightLevel(DAWN_LIGHT, 0)).toBe(25);
  expect(lightLevel(DUSK_LIGHT, 360)).toBe(30);
  expect(lightPhase(360)).toBe('rise');
});
