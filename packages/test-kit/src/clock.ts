import { DEFAULT_TICK_MS, DomainError, tickOf, type GameClock } from '@duskmarch/domain';

/** Часы, которые двигаются только явными вызовами. */
export class FakeClock implements GameClock {
  private ms: number;

  constructor(
    start = 0,
    readonly tickMs = DEFAULT_TICK_MS,
    private utcBase = Date.UTC(2026, 0, 1),
  ) {
    this.ms = start;
  }

  advance(ms: number): number {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new DomainError('ERR_CLOCK_REGRESSION', `шаг ${ms} мс отрицателен`);
    }
    this.ms += ms;
    return this.ms;
  }

  /** Продвигает на `n` тиков. */
  advanceTicks(n = 1): number {
    return this.advance(n * this.tickMs);
  }

  setTime(ms: number): void {
    if (ms < this.ms) throw new DomainError('ERR_CLOCK_REGRESSION', `${ms} < ${this.ms}`);
    this.ms = ms;
  }

  now(): number {
    return this.ms;
  }

  tick(): number {
    return tickOf(this.ms, this.tickMs);
  }

  utc(): number {
    return this.utcBase + this.ms;
  }
}
