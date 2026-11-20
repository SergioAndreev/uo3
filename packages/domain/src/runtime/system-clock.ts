import {
  assertNonNegativeIntegerMs,
  assertPositiveIntegerMs,
  DEFAULT_MAX_TICK_DELTA_MS,
  DEFAULT_SIM_TICK_MS,
  type GameClockSnapshot,
  type LatchableGameClock,
  type SystemGameClockOptions,
} from "./clock.js";

interface PerformanceLike {
  now(): number;
}

function defaultMonotonicSource(): number {
  const perf = (globalThis as { readonly performance?: PerformanceLike }).performance;
  return perf !== undefined ? perf.now() : Date.now();
}

function defaultWallClockSource(): number {
  return Date.now();
}

export class SystemGameClock implements LatchableGameClock {
  public readonly tickMs: number;
  private readonly maxTickDeltaMs: number;
  private readonly monotonicSource: () => number;
  private readonly wallClockSource: () => number;
  private readonly onDrift: ((droppedMs: number) => void) | undefined;

  private lastMonotonicMs: number;
  private latchedNowMs: number;
  private latchedWallClockMs: number;

  public constructor(options: SystemGameClockOptions = {}) {
    this.tickMs = assertPositiveIntegerMs(options.tickMs ?? DEFAULT_SIM_TICK_MS, "tickMs");
    this.maxTickDeltaMs = assertPositiveIntegerMs(
      options.maxTickDeltaMs ?? DEFAULT_MAX_TICK_DELTA_MS,
      "maxTickDeltaMs",
    );
    this.latchedNowMs = assertNonNegativeIntegerMs(options.startNowMs ?? 0, "startNowMs");
    this.monotonicSource = options.monotonicSource ?? defaultMonotonicSource;
    this.wallClockSource = options.wallClockSource ?? defaultWallClockSource;
    this.onDrift = options.onDrift;

    this.lastMonotonicMs = this.monotonicSource();
    this.latchedWallClockMs = Math.max(0, Math.floor(this.wallClockSource()));
  }

  public get nowMs(): number {
    return this.latchedNowMs;
  }

  public get currentTick(): number {
    return Math.floor(this.latchedNowMs / this.tickMs);
  }

  public get wallClockEpochMs(): number {
    return this.latchedWallClockMs;
  }

  public latch(): number {
    const currentMono = this.monotonicSource();
    const rawDelta = Math.max(0, Math.floor(currentMono - this.lastMonotonicMs));
    this.lastMonotonicMs = currentMono;
    this.latchedWallClockMs = Math.max(0, Math.floor(this.wallClockSource()));

    if (rawDelta > this.maxTickDeltaMs) {
      const droppedMs = rawDelta - this.maxTickDeltaMs;
      this.latchedNowMs += this.maxTickDeltaMs;
      this.onDrift?.(droppedMs);
      return this.maxTickDeltaMs;
    }

    this.latchedNowMs += rawDelta;
    return rawDelta;
  }

  public snapshot(): GameClockSnapshot {
    return {
      nowMs: this.latchedNowMs,
      tickMs: this.tickMs,
      wallClockEpochMs: this.latchedWallClockMs,
    };
  }
}
