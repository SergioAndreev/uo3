import { SeededRng } from '@duskmarch/domain';
import { describe, expect, it, vi } from 'vitest';
import { EngineError } from './errors.js';
import { Scheduler, type TickContext } from './scheduler.js';
import { TimingWheel, WHEEL_RANGE_TICKS } from './timing-wheel.js';

const runUntil = (wheel: TimingWheel, tick: number) => {
  while (wheel.currentTick < tick) for (const f of wheel.advance().due) f();
};

describe('колесо таймеров', () => {
  it('каскадный перенос: +4, +2 400, +72 000 тиков', () => {
    const wheel = new TimingWheel();
    const fired: [string, number][] = [];
    for (const [name, ticks] of [
      ['a', 4],
      ['b', 2_400],
      ['c', 72_000],
    ] as const) {
      wheel.schedule(ticks, () => fired.push([name, wheel.currentTick]));
    }
    runUntil(wheel, 72_001);
    expect(fired).toEqual([
      ['a', 4],
      ['b', 2_400],
      ['c', 72_000],
    ]);
  });

  it('очередь переполнения: 45 суток за пределами колеса; дальние сроки срабатывают точно', () => {
    expect((45 * 86_400_000) / 50).toBeGreaterThan(new TimingWheel().rangeTicks);
    expect(new TimingWheel().rangeTicks).toBe(WHEEL_RANGE_TICKS);
    // Тот же алгоритм на колесе 4×4×4 (64 тика): переполнение проверяется за разумное число шагов.
    for (const start of [0, 61, 64]) {
      const wheel = new TimingWheel(start, [4, 4, 4]);
      const fired: [number, number][] = [];
      for (const delay of [1, 3, 4, 17, 63, 64, 65, 200, 1_000]) {
        wheel.schedule(delay, () => fired.push([delay, wheel.currentTick - start]));
      }
      while (wheel.currentTick < start + 1_001) for (const f of wheel.advance().due) f();
      expect(fired.every(([d, at]) => d === at)).toBe(true);
      expect(fired).toHaveLength(9);
    }
  });

  it('порядок в тике: critical, затем по постановке', () => {
    const wheel = new TimingWheel();
    const order: string[] = [];
    wheel.schedule(3, () => order.push('T1'));
    wheel.schedule(3, () => order.push('T2'));
    wheel.schedule(3, () => order.push('crit'), 'critical');
    runUntil(wheel, 3);
    expect(order).toEqual(['crit', 'T1', 'T2']);
  });

  it('отмена: повторная и устаревшая — false; остаток; периодический без дрейфа', () => {
    const wheel = new TimingWheel();
    const fired: number[] = [];
    const handle = wheel.schedule(2, () => fired.push(wheel.currentTick));
    expect(wheel.remaining(handle)).toBe(2);
    runUntil(wheel, 2);
    expect(wheel.cancel(handle)).toBe(false);
    expect(wheel.remaining(handle)).toBeNull();
    const next = wheel.schedule(1, () => undefined);
    expect(wheel.cancel({ id: next.id, generation: 99 })).toBe(false);
    expect(wheel.cancel(next)).toBe(true);
    expect(wheel.cancel(next)).toBe(false);
    const ticks: number[] = [];
    const periodic = wheel.every(3, () => ticks.push(wheel.currentTick));
    runUntil(wheel, 12);
    expect(ticks).toEqual([5, 8, 11]);
    expect(wheel.cancel(periodic)).toBe(true);
    expect(wheel.size).toBe(0);
  });

  it('недопустимые задержки', () => {
    const wheel = new TimingWheel();
    for (const bad of [
      () => wheel.schedule(-1, () => 0),
      () => wheel.schedule(Number.NaN, () => 0),
      () => wheel.every(0, () => 0),
      () => wheel.scheduleAt(Infinity, () => 0),
    ]) {
      expect(bad).toThrow(expect.objectContaining({ code: 'SCHEDULER_INVALID_DELAY' }));
    }
    expect(wheel.size).toBe(0);
  });

  it('100 000 таймеров и 20 000 отмен — стоимость не растёт линейно', () => {
    const wheel = new TimingWheel();
    const t0 = performance.now();
    const handles = Array.from({ length: 100_000 }, (_, i) =>
      wheel.schedule(1 + ((i * 7919) % 1_728_000), () => 0),
    );
    for (let i = 0; i < 20_000; i++) wheel.cancel(handles[i * 5] as never);
    const perOp = (performance.now() - t0) / 120_000;
    expect(wheel.size).toBe(80_000);
    expect(perOp).toBeLessThan(0.05);
    const t1 = performance.now();
    for (let i = 0; i < 1_000; i++) wheel.schedule(i + 1, () => 0);
    expect((performance.now() - t1) / 1_000).toBeLessThan(0.05);
  });

  it('миллион активных таймеров', () => {
    const wheel = new TimingWheel();
    for (let i = 0; i < 1_000_000; i++) wheel.schedule(1 + (i % 500_000), () => 0);
    expect(wheel.size).toBe(1_000_000);
  }, 30_000);
});

describe('планировщик', () => {
  it('одно время для всех обработчиков тика и канонический порядок фаз', () => {
    const s = new Scheduler();
    const seen: string[] = [];
    const ctxs: TickContext[] = [];
    s.register({
      name: 'b',
      priority: 20,
      run: (c) => {
        seen.push('system20');
        ctxs.push(c);
      },
    });
    s.register({
      name: 'a',
      priority: 10,
      run: (c) => {
        seen.push('system10');
        ctxs.push(c);
      },
    });
    s.onPostTick((c) => {
      seen.push('post');
      ctxs.push(c);
    });
    s.after(50, () => seen.push('timer'));
    s.enqueue({
      sessionOrder: 0,
      sequence: 0,
      apply: (c) => {
        seen.push('ingress');
        ctxs.push(c);
      },
    });
    s.advance(1);
    expect(seen).toEqual(['ingress', 'timer', 'system10', 'system20', 'post']);
    expect(new Set(ctxs.map((c) => `${c.tick}:${c.timeMs}`))).toEqual(new Set(['1:50']));
    s.advance(41);
    expect(s.timeMs).toBe(2_100);
  });

  it('равный приоритет — порядок регистрации; команды — канонический порядок', () => {
    const s = new Scheduler();
    const order: string[] = [];
    s.register({ name: 'A', priority: 50, run: () => order.push('A') });
    s.register({ name: 'B', priority: 50, run: () => order.push('B') });
    s.enqueue({ sessionOrder: 2, sequence: 1, apply: () => order.push('s2#1') });
    s.enqueue({ sessionOrder: 1, sequence: 7, apply: () => order.push('s1#7') });
    s.enqueue({ sessionOrder: 1, sequence: 3, apply: () => order.push('s1#3') });
    s.advance();
    expect(order).toEqual(['s1#3', 's1#7', 's2#1', 'A', 'B']);
  });

  it('очередь: 2 000 за тик, перенос остатка, переполнение', () => {
    const s = new Scheduler();
    let applied = 0;
    for (let i = 0; i < 2_500; i++)
      s.enqueue({ sessionOrder: 0, sequence: i, apply: () => applied++ });
    s.advance();
    expect(applied).toBe(2_000);
    expect(s.ingressLength).toBe(500);
    for (let i = 0; i < 9_500; i++)
      s.enqueue({ sessionOrder: 0, sequence: i, apply: () => applied++ });
    expect(() => s.enqueue({ sessionOrder: 0, sequence: 0, apply: () => 0 })).toThrow(
      expect.objectContaining({ code: 'SCHEDULER_INGRESS_OVERFLOW' }),
    );
  });

  it('догоняющие тики и отбрасывание дрейфа', () => {
    const onDrift = vi.fn();
    const s = new Scheduler({ onDrift });
    s.pump(1_000);
    expect(s.pump(1_150)).toBe(3);
    expect(onDrift).not.toHaveBeenCalled();
    expect(s.pump(2_350)).toBe(5);
    expect(onDrift).toHaveBeenCalledWith(950);
    expect(s.pump(2_400)).toBe(1);
    expect(s.pump(1_000)).toBe(0);
    expect(s.tick).toBe(9);
  });

  it('таймер с задержкой 0 из обработчика — следующий тик; отмена соседа; изоляция исключения', () => {
    const onError = vi.fn();
    const s = new Scheduler({ onError });
    const log: string[] = [];
    s.after(100, () => {
      log.push(`outer@${s.tick}`);
      s.after(0, () => log.push(`inner@${s.tick}`));
      s.cancel(t2);
      throw new Error('сбой');
    });
    const t2 = s.after(100, () => log.push('t2'));
    s.after(100, () => log.push(`t3@${s.tick}`));
    s.register({ name: 'sys', priority: 1, run: (c) => log.push(`sys@${c.tick}`) });
    s.advance(3);
    expect(log).toEqual(['sys@1', 'outer@2', 't3@2', 'sys@2', 'inner@3', 'sys@3']);
    expect(onError).toHaveBeenCalledOnce();
    expect(s.errors).toBe(1);
    expect(() => s.after(-50, () => 0)).toThrow(EngineError);
    expect(() => s.every(0, () => 0)).toThrow(EngineError);
    const p = s.every(100, () => log.push('p'));
    expect(s.remainingMs(p)).toBe(100);
  });

  it('бюджет фоновых задач: перенос остатка', () => {
    let now = 0;
    const s = new Scheduler({ perfNow: () => now });
    let critical = 0;
    let background = 0;
    s.after(50, () => critical++, 'critical');
    s.after(50, () => critical++, 'critical');
    for (let i = 0; i < 500; i++)
      s.after(
        50,
        () => {
          background++;
          now += 0.05;
        },
        'background',
      );
    s.advance();
    expect(critical).toBe(2);
    expect(background).toBe(200);
    expect(s.carriedBackgroundCount).toBe(300);
    s.advance();
    expect(background).toBe(400);
    s.advance();
    expect(background).toBe(500);
  });

  it('деградация после 10 перерасходов и восстановление', () => {
    let now = 0;
    let cost = 60;
    const onStatus = vi.fn();
    const s = new Scheduler({ perfNow: () => now, onStatus });
    s.register({ name: 'heavy', priority: 0, run: () => (now += cost) });
    s.advance(9);
    expect(s.status).toBe('healthy');
    s.advance(1);
    expect(s.status).toBe('degraded');
    cost = 5;
    s.advance(300);
    expect(s.status).toBe('healthy');
    expect(onStatus.mock.calls.map((c) => c[0])).toEqual(['degraded', 'healthy']);
    expect(s.tickP99Ms).toBeLessThan(35);
  });

  it('воспроизводимость двух прогонов и пауза', () => {
    const run = () => {
      const s = new Scheduler();
      const rng = new SeededRng('p06');
      const trace: number[] = [];
      s.register({
        name: 'r',
        priority: 0,
        run: (c) => trace.push(c.tick * 1000 + rng.int(0, 999)),
      });
      for (let i = 0; i < 50; i++) s.after(rng.int(1, 5_000), () => trace.push(-s.tick));
      s.advance(1_000);
      return { trace, state: rng.snapshot() };
    };
    expect(run()).toEqual(run());
    const s = new Scheduler();
    let calls = 0;
    s.register({ name: 'x', priority: 0, run: () => calls++ });
    s.advance(1);
    s.paused = true;
    s.advance(10);
    expect(calls).toBe(1);
    s.paused = false;
    s.advance(10);
    expect(calls).toBe(11);
  });

  it('драйвер реального времени', async () => {
    const s = new Scheduler({ tickMs: 10 });
    s.start();
    await new Promise((resolve) => setTimeout(resolve, 80));
    s.stop();
    expect(s.tick).toBeGreaterThan(2);
  });
});
