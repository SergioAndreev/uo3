import { EngineError } from './errors.js';
import { TimingWheel, type TimerHandle, type TimerPriority } from './timing-wheel.js';

export const PHASES = ['LATCH', 'INGRESS', 'TIMERS', 'SYSTEMS', 'POST_TICK', 'TELEMETRY'] as const;
export type Phase = (typeof PHASES)[number];

/** Зафиксированное время тика: одно значение для всех обработчиков. */
export interface TickContext {
  readonly tick: number;
  /** Игровое время, мс: `tick × tickMs`. */
  readonly timeMs: number;
}

export interface SimSystem {
  readonly name: string;
  readonly priority: number;
  run(ctx: TickContext): void;
}

export interface IngressItem {
  readonly sessionOrder: number;
  readonly sequence: number;
  readonly apply: (ctx: TickContext) => void;
}

export interface SchedulerOptions {
  tickMs?: number;
  maxCatchUpTicks?: number;
  ingressPerTick?: number;
  ingressCapacity?: number;
  /** Бюджет фоновых таймеров за тик, мс. */
  backgroundBudgetMs?: number;
  warnMs?: number;
  /** Монотонные часы для замеров (не для игрового времени). */
  perfNow?: () => number;
  onError?: (error: unknown, where: string) => void;
  onDrift?: (droppedMs: number) => void;
  onStatus?: (status: 'healthy' | 'degraded') => void;
}

interface Queued extends IngressItem {
  enqueuedTick: number;
  order: number;
}

/** Детерминированный планировщик тиков 20 Гц. */
export class Scheduler {
  readonly tickMs: number;
  readonly wheel = new TimingWheel();
  private readonly systems: (SimSystem & { order: number })[] = [];
  private readonly postTick: ((ctx: TickContext) => void)[] = [];
  private queue: Queued[] = [];
  private carriedBackground: (() => void)[] = [];
  private queued = 0;
  private registrations = 0;
  private accumulator = 0;
  private lastWall: number | null = null;
  private readonly durations: number[] = [];
  private overBudgetStreak = 0;
  status: 'healthy' | 'degraded' = 'healthy';
  errors = 0;
  droppedMs = 0;
  paused = false;
  private timer: NodeJS.Timeout | undefined;
  private readonly o: Required<Omit<SchedulerOptions, 'onError' | 'onDrift' | 'onStatus'>> &
    Pick<SchedulerOptions, 'onError' | 'onDrift' | 'onStatus'>;

  constructor(options: SchedulerOptions = {}) {
    this.o = {
      tickMs: 50,
      maxCatchUpTicks: 5,
      ingressPerTick: 2_000,
      ingressCapacity: 10_000,
      backgroundBudgetMs: 10,
      warnMs: 35,
      perfNow: () => performance.now(),
      ...options,
    };
    this.tickMs = this.o.tickMs;
  }

  get tick(): number {
    return this.wheel.currentTick;
  }

  get timeMs(): number {
    return this.tick * this.tickMs;
  }

  register(system: SimSystem): void {
    this.systems.push({ ...system, run: system.run.bind(system), order: this.registrations++ });
    this.systems.sort((a, b) => a.priority - b.priority || a.order - b.order);
  }

  onPostTick(hook: (ctx: TickContext) => void): void {
    this.postTick.push(hook);
  }

  enqueue(item: IngressItem): void {
    if (this.queue.length >= this.o.ingressCapacity) {
      throw new EngineError(
        'SCHEDULER_INGRESS_OVERFLOW',
        `очередь заполнена (${this.o.ingressCapacity})`,
      );
    }
    this.queue.push({ ...item, enqueuedTick: this.tick, order: this.queued++ });
  }

  get ingressLength(): number {
    return this.queue.length;
  }

  /** Таймер через `delayMs` мс игрового времени. */
  after(delayMs: number, callback: () => void, priority: TimerPriority = 'normal'): TimerHandle {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new EngineError('SCHEDULER_INVALID_DELAY', `задержка ${delayMs} мс`);
    }
    return this.wheel.schedule(Math.ceil(delayMs / this.tickMs), callback, priority);
  }

  every(intervalMs: number, callback: () => void, priority: TimerPriority = 'normal'): TimerHandle {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new EngineError('SCHEDULER_INVALID_DELAY', `интервал ${intervalMs} мс`);
    }
    return this.wheel.every(Math.ceil(intervalMs / this.tickMs), callback, priority);
  }

  cancel(handle: TimerHandle): boolean {
    return this.wheel.cancel(handle);
  }

  remainingMs(handle: TimerHandle): number | null {
    const ticks = this.wheel.remaining(handle);
    return ticks === null ? null : ticks * this.tickMs;
  }

  private guard(where: string, body: () => void): void {
    try {
      body();
    } catch (error) {
      this.errors++;
      this.o.onError?.(error, where);
    }
  }

  /** Один тик: шесть фаз в каноническом порядке. */
  step(): TickContext {
    const started = this.o.perfNow();
    const { tick, due, background } = this.wheel.advance();
    const ctx: TickContext = Object.freeze({ tick, timeMs: tick * this.tickMs });
    const batch = this.queue
      .sort(
        (a, b) =>
          a.enqueuedTick - b.enqueuedTick ||
          a.sessionOrder - b.sessionOrder ||
          a.sequence - b.sequence ||
          a.order - b.order,
      )
      .slice(0, this.o.ingressPerTick);
    this.queue = this.queue.slice(batch.length);
    for (const item of batch) this.guard('ingress', () => item.apply(ctx));
    for (const fire of due) this.guard('timer', fire);
    const backlog = [...this.carriedBackground, ...background];
    this.carriedBackground = [];
    const bgStart = this.o.perfNow();
    for (let i = 0; i < backlog.length; i++) {
      if (i > 0 && this.o.perfNow() - bgStart >= this.o.backgroundBudgetMs) {
        this.carriedBackground = backlog.slice(i);
        break;
      }
      this.guard('background', backlog[i] as () => void);
    }
    for (const system of this.systems) this.guard(`system:${system.name}`, () => system.run(ctx));
    for (const hook of this.postTick) this.guard('post-tick', () => hook(ctx));
    this.telemetry(this.o.perfNow() - started);
    return ctx;
  }

  get carriedBackgroundCount(): number {
    return this.carriedBackground.length;
  }

  private telemetry(ms: number): void {
    this.durations.push(ms);
    if (this.durations.length > 200) this.durations.shift();
    this.overBudgetStreak = ms > this.tickMs ? this.overBudgetStreak + 1 : 0;
    // p99 осмыслен только на окне от 100 тиков; восстановление — только по нему, без дрожания.
    const windowed = this.durations.length >= 100;
    const p99 = windowed ? this.tickP99Ms : 0;
    let next = this.status;
    if (this.overBudgetStreak >= 10 || p99 > 45) next = 'degraded';
    else if (
      this.status === 'degraded' &&
      windowed &&
      p99 < this.o.warnMs &&
      this.overBudgetStreak === 0
    ) {
      next = 'healthy';
    }
    if (next !== this.status) {
      this.status = next;
      this.o.onStatus?.(next);
    }
  }

  get tickP99Ms(): number {
    if (this.durations.length === 0) return 0;
    const sorted = [...this.durations].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] as number;
  }

  /** Ручной режим: ровно `n` тиков (на паузе — ни одного). */
  advance(n = 1): void {
    if (this.paused) return;
    for (let i = 0; i < n; i++) this.step();
  }

  /**
   * Реальное время: накопленные `elapsedMs` превращаются в тики, не более `maxCatchUpTicks` за проход;
   * остаток сверх лимита отбрасывается как дрейф.
   */
  pump(wallNowMs: number): number {
    if (this.lastWall === null || wallNowMs < this.lastWall) {
      this.lastWall = wallNowMs;
      return 0;
    }
    this.accumulator += wallNowMs - this.lastWall;
    this.lastWall = wallNowMs;
    let ran = 0;
    while (this.accumulator >= this.tickMs && ran < this.o.maxCatchUpTicks) {
      if (!this.paused) this.step();
      this.accumulator -= this.tickMs;
      ran++;
    }
    if (this.accumulator >= this.tickMs) {
      const dropped = this.accumulator - (this.accumulator % this.tickMs);
      this.droppedMs += dropped;
      this.accumulator -= dropped;
      this.o.onDrift?.(dropped);
    }
    return ran;
  }

  /** Драйвер реального времени на монотонных часах процесса. */
  start(now: () => number = () => performance.now()): void {
    this.pump(now());
    const loop = () => {
      this.pump(now());
      const wait = Math.max(0, this.tickMs - this.accumulator);
      this.timer = setTimeout(loop, wait);
    };
    this.timer = setTimeout(loop, this.tickMs);
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
