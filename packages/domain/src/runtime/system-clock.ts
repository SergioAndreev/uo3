import { DEFAULT_TICK_MS, tickOf, type GameClock } from './clock.js';

export interface ClockSources {
  /** Монотонный таймер, мс. */
  monotonic: () => number;
  utc: () => number;
}

export interface DriftEvent {
  /** Отброшенная часть интервала, мс. */
  droppedMs: number;
}

export interface SystemClockOptions {
  tickMs?: number;
  /** Наибольший шаг игрового времени за одну фиксацию. */
  maxStepMs?: number;
  onDrift?: (event: DriftEvent) => void;
  sources?: ClockSources;
}

// В изоморфных типах нет `performance`; в браузере и Node.js 22 он есть.
const timer = (globalThis as { performance?: { now(): number } }).performance;
const DEFAULT_SOURCES: ClockSources = {
  monotonic: () => timer?.now() ?? Date.now(),
  utc: () => Date.now(),
};

/** Единственный модуль ядра, читающий системное время; остальной код получает GameClock. */
export class SystemClock implements GameClock {
  readonly tickMs: number;
  private readonly maxStepMs: number;
  private readonly sources: ClockSources;
  private readonly onDrift: ((event: DriftEvent) => void) | undefined;
  private last: number;
  private game = 0;
  private stamp: number;

  constructor(options: SystemClockOptions = {}) {
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.maxStepMs = options.maxStepMs ?? 250;
    this.sources = options.sources ?? DEFAULT_SOURCES;
    this.onDrift = options.onDrift;
    this.last = this.sources.monotonic();
    this.stamp = this.sources.utc();
  }

  /** Фиксирует время нового тика; вызывается игровым циклом. */
  capture(): number {
    const mono = this.sources.monotonic();
    const elapsed = Math.max(0, mono - this.last);
    this.last = mono;
    const step = Math.min(elapsed, this.maxStepMs);
    if (elapsed > this.maxStepMs)
      this.onDrift?.({ droppedMs: Math.round(elapsed - this.maxStepMs) });
    this.game += Math.round(step);
    this.stamp = this.sources.utc();
    return this.game;
  }

  now(): number {
    return this.game;
  }

  tick(): number {
    return tickOf(this.game, this.tickMs);
  }

  utc(): number {
    return this.stamp;
  }
}
