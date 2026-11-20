import { describe, expect, it, vi } from "vitest";
import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import {
  DEFAULT_MAX_TICK_DELTA_MS,
  DEFAULT_SIM_TICK_MS,
  GameClockSnapshotValidator,
} from "./clock.js";
import { SystemGameClock } from "./system-clock.js";

function expectDomainError(fn: () => unknown, code: DomainErrorCode): DomainError {
  try {
    fn();
    expect.unreachable(`Expected DomainError(${code})`);
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    const domainErr = err as DomainError;
    expect(domainErr.code).toBe(code);
    return domainErr;
  }
}

describe("domain/deterministic-runtime — SystemGameClock & GameClockSnapshotSchema", () => {
  it("returns identical nowMs and currentTick across repeated reads within a single tick", () => {
    let mono = 1000;
    let wall = 1_700_000_000_000;
    const clock = new SystemGameClock({
      tickMs: DEFAULT_SIM_TICK_MS,
      startNowMs: 10_000,
      monotonicSource: () => mono,
      wallClockSource: () => wall,
    });

    // Advance underlying clock without calling latch()
    mono += 35;
    wall += 35;

    for (let i = 0; i < 5; i++) {
      expect(clock.nowMs).toBe(10_000);
      expect(clock.currentTick).toBe(200);
      expect(clock.wallClockEpochMs).toBe(1_700_000_000_000);
    }
  });

  it("computes currentTick accurately on 50ms boundaries (49 -> 0, 50 -> 1, 99 -> 1)", () => {
    let mono = 0;
    const clock = new SystemGameClock({
      tickMs: 50,
      monotonicSource: () => mono,
      wallClockSource: () => 1_700_000_000_000 + mono,
    });

    mono = 49;
    expect(clock.latch()).toBe(49);
    expect(clock.nowMs).toBe(49);
    expect(clock.currentTick).toBe(0);

    mono = 50;
    expect(clock.latch()).toBe(1);
    expect(clock.nowMs).toBe(50);
    expect(clock.currentTick).toBe(1);

    mono = 99;
    expect(clock.latch()).toBe(49);
    expect(clock.nowMs).toBe(99);
    expect(clock.currentTick).toBe(1);
  });

  it("remains strictly monotonic when wall clock jumps backward by -60_000ms (NTP correction)", () => {
    let mono = 500;
    let wall = 1_700_000_100_000;
    const clock = new SystemGameClock({
      tickMs: 50,
      monotonicSource: () => mono,
      wallClockSource: () => wall,
    });

    mono += 50;
    wall -= 60_000;
    const delta = clock.latch();

    expect(delta).toBe(50);
    expect(clock.nowMs).toBe(50);
    expect(clock.wallClockEpochMs).toBe(1_700_000_040_000);

    // Even if monotonic source reports slight negative jitter, nowMs never decreases
    mono -= 10;
    expect(clock.latch()).toBe(0);
    expect(clock.nowMs).toBe(50);
  });

  it("clamps tick delta to maxTickDeltaMs (250ms) and invokes onDrift(950) on a 1200ms pause", () => {
    let mono = 100;
    const onDrift = vi.fn();
    const clock = new SystemGameClock({
      tickMs: 50,
      maxTickDeltaMs: DEFAULT_MAX_TICK_DELTA_MS,
      monotonicSource: () => mono,
      wallClockSource: () => 1_700_000_000_000,
      onDrift,
    });

    mono += 1_200;
    const applied = clock.latch();
    expect(applied).toBe(250);
    expect(clock.nowMs).toBe(250);
    expect(clock.currentTick).toBe(5);
    expect(onDrift).toHaveBeenCalledTimes(1);
    expect(onDrift).toHaveBeenCalledWith(950);

    // Also works without onDrift callback
    let mono2 = 0;
    const clockNoCb = new SystemGameClock({
      monotonicSource: () => mono2,
      wallClockSource: () => 1000,
    });
    mono2 += 1000;
    expect(clockNoCb.latch()).toBe(250);
  });

  it("uses default performance/Date sources, produces valid snapshots, and validates options", () => {
    const defaultClock = new SystemGameClock();
    expect(defaultClock.tickMs).toBe(50);
    expect(defaultClock.nowMs).toBe(0);
    expect(defaultClock.wallClockEpochMs).toBeGreaterThan(0);
    defaultClock.latch();
    const snap = defaultClock.snapshot();
    expect(GameClockSnapshotValidator.Check(snap)).toBe(true);

    // Schema negative cases
    expect(
      GameClockSnapshotValidator.Check({ nowMs: -1, tickMs: 50, wallClockEpochMs: 1000 }),
    ).toBe(false);
    expect(
      GameClockSnapshotValidator.Check({ nowMs: 12.5, tickMs: 50, wallClockEpochMs: 1000 }),
    ).toBe(false);
    expect(GameClockSnapshotValidator.Check({ nowMs: 0, tickMs: 0, wallClockEpochMs: 1000 })).toBe(
      false,
    );

    // Constructor validation
    expectDomainError(
      () => new SystemGameClock({ tickMs: 0 }),
      DomainErrorCode.ERR_INVALID_TIME_DELTA,
    );
    expectDomainError(
      () => new SystemGameClock({ maxTickDeltaMs: -5 }),
      DomainErrorCode.ERR_INVALID_TIME_DELTA,
    );
    expectDomainError(
      () => new SystemGameClock({ startNowMs: -1 }),
      DomainErrorCode.ERR_INVALID_TIME_DELTA,
    );
    expectDomainError(
      () => new SystemGameClock({ startNowMs: 12.5 }),
      DomainErrorCode.ERR_INVALID_TIME_DELTA,
    );
  });
});
