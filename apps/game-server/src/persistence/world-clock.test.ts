import { SeededRng, formatGameTime } from '@duskmarch/domain';
import { describe, expect, it } from 'vitest';
import {
  STAGGER_PER_TICK,
  WorldClock,
  decodeRng,
  encodeRng,
  planTimers,
  type StoredTimer,
} from './world-clock.js';

const HOUR = 240_000;

describe('persistence/world-store: время, ГПСЧ и таймеры', () => {
  it('игровое время продолжает ход с 14:30, ГПСЧ — с сохранённого снимка', () => {
    const rng = new SeededRng('ember:root');
    const saved = { gameTimeMs: 14.5 * HOUR, rngState: encodeRng(rng.snapshot()) };
    const expected = new SeededRng(decodeRng(saved.rngState));
    const clock = new WorldClock(saved, 50, HOUR, 1_000);
    expect(formatGameTime(clock.time(1_000))).toBe('14:30');
    expect(formatGameTime(clock.time(1_000 + 4_800))).toBe('15:30');
    expect([clock.rng.next(), clock.rng.next()]).toEqual([expected.next(), expected.next()]);
    const snap = clock.snapshot(1_000 + 4_800);
    expect(snap.gameTimeMs).toBe(15.5 * HOUR);
    const restarted = new WorldClock(snap, 50, HOUR);
    expect(formatGameTime(restarted.time(0))).toBe('15:30');
    expect(restarted.rng.next()).toBe(expected.next());
    expect(() => decodeRng('xyz')).toThrow();
  });

  it('распад после 45 минут простоя: остаток 20 минут от запуска', () => {
    const stopped = new Date('2026-11-26T10:00:00Z');
    const now = new Date(stopped.getTime() + 45 * 60_000);
    const decay: StoredTimer = {
      id: 'a',
      kind: 'decay',
      policy: 'pause',
      remainingMs: 20 * 60_000,
      dueAt: new Date(stopped.getTime() + 20 * 60_000),
    };
    const wall: StoredTimer = {
      id: 'b',
      kind: 'contract',
      policy: 'wall',
      remainingMs: 0,
      dueAt: new Date(stopped.getTime() + 10 * 60_000),
    };
    const later: StoredTimer = {
      id: 'c',
      kind: 'contract',
      policy: 'wall',
      remainingMs: 0,
      dueAt: new Date(now.getTime() + 60_000),
    };
    const plan = planTimers([decay, wall, later], now, 50);
    expect(plan.find((p) => p.timer.id === 'a')?.delayMs).toBe(20 * 60_000);
    expect(plan.find((p) => p.timer.id === 'b')?.delayMs).toBe(0);
    expect(plan.find((p) => p.timer.id === 'c')?.delayMs).toBe(60_000);
  });

  it('2 000 просроченных таймеров появления — не больше 100 на тик', () => {
    const now = new Date('2026-11-26T12:00:00Z');
    const timers: StoredTimer[] = Array.from({ length: 2_000 }, (_, i) => ({
      id: `s${i}`,
      kind: 'spawn',
      policy: 'staggered',
      remainingMs: 0,
      dueAt: new Date(now.getTime() - 60_000 + i),
    }));
    const plan = planTimers(timers, now, 50);
    const perTick = new Map<number, number>();
    for (const p of plan) perTick.set(p.delayMs, (perTick.get(p.delayMs) ?? 0) + 1);
    expect(Math.max(...perTick.values())).toBe(STAGGER_PER_TICK);
    expect(perTick.size).toBe(20);
    expect(Math.min(...perTick.keys())).toBe(50);
  });
});
