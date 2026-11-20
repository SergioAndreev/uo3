import {
  DEFAULT_SIM_TICK_MS,
  DomainError,
  DomainErrorCode,
  GameClockSnapshotValidator,
  type GameClock,
  type GameClockSnapshot,
} from "@uo3/domain";

export interface FakeGameClockOptions {
  readonly startMs?: number;
  readonly tickMs?: number;
  readonly wallClockEpochMs?: number;
}

const DEFAULT_TEST_WALL_CLOCK_EPOCH_MS = 946_684_800_000; // 2000-01-01T00:00:00.000Z

function assertNonNegativeInt(value: number, fieldPath: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_TIME_DELTA,
      `Invalid time value for "${fieldPath}": expected non-negative integer, got ${String(value)}`,
      { fieldPath, details: { value } },
    );
  }
  return value;
}

function assertPositiveInt(value: number, fieldPath: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_TIME_DELTA,
      `Invalid tickMs "${fieldPath}": expected integer >= 1, got ${String(value)}`,
      { fieldPath, details: { value } },
    );
  }
  return value;
}

export class FakeGameClock implements GameClock {
  private currentNowMs: number;
  private currentTickMs: number;
  private currentWallClockEpochMs: number;

  public constructor(options: FakeGameClockOptions = {}) {
    this.currentNowMs = assertNonNegativeInt(options.startMs ?? 0, "startMs");
    this.currentTickMs = assertPositiveInt(options.tickMs ?? DEFAULT_SIM_TICK_MS, "tickMs");
    this.currentWallClockEpochMs = assertNonNegativeInt(
      options.wallClockEpochMs ?? DEFAULT_TEST_WALL_CLOCK_EPOCH_MS + this.currentNowMs,
      "wallClockEpochMs",
    );
  }

  public get nowMs(): number {
    return this.currentNowMs;
  }

  public get tickMs(): number {
    return this.currentTickMs;
  }

  public get currentTick(): number {
    return Math.floor(this.currentNowMs / this.currentTickMs);
  }

  public get wallClockEpochMs(): number {
    return this.currentWallClockEpochMs;
  }

  public advanceBy(deltaMs: number): void {
    const validDelta = assertNonNegativeInt(deltaMs, "deltaMs");
    this.currentNowMs += validDelta;
    this.currentWallClockEpochMs += validDelta;
  }

  public advanceTicks(count: number): void {
    const validCount = assertNonNegativeInt(count, "count");
    this.advanceBy(validCount * this.currentTickMs);
  }

  public advanceTo(targetMs: number): void {
    const validTarget = assertNonNegativeInt(targetMs, "targetMs");
    if (validTarget < this.currentNowMs) {
      throw new DomainError(
        DomainErrorCode.ERR_CLOCK_BACKWARD_JUMP,
        `Cannot move FakeGameClock backward from ${this.currentNowMs}ms to ${validTarget}ms`,
        {
          fieldPath: "targetMs",
          details: { currentNowMs: this.currentNowMs, targetMs: validTarget },
        },
      );
    }
    const delta = validTarget - this.currentNowMs;
    this.currentNowMs = validTarget;
    this.currentWallClockEpochMs += delta;
  }

  public snapshot(): GameClockSnapshot {
    return {
      nowMs: this.currentNowMs,
      tickMs: this.currentTickMs,
      wallClockEpochMs: this.currentWallClockEpochMs,
    };
  }

  public restore(snapshot: GameClockSnapshot): void {
    if (!GameClockSnapshotValidator.Check(snapshot)) {
      throw new DomainError(
        DomainErrorCode.ERR_INVALID_TIME_DELTA,
        "Invalid GameClockSnapshot passed to FakeGameClock.restore()",
        { fieldPath: "snapshot", details: { snapshot } },
      );
    }
    this.currentNowMs = snapshot.nowMs;
    this.currentTickMs = snapshot.tickMs;
    this.currentWallClockEpochMs = snapshot.wallClockEpochMs;
  }
}
