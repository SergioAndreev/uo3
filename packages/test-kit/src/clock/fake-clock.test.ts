import { DomainError, DomainErrorCode, GameClockSnapshotValidator } from "@uo3/domain";
import { describe, expect, it } from "vitest";
import { FakeGameClock } from "./fake-clock.js";

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

describe("@uo3/test-kit — FakeGameClock", () => {
  it("advances deterministically by ticks, milliseconds, and target timestamps", () => {
    const clock = new FakeGameClock({ startMs: 0, tickMs: 50 });
    expect(clock.nowMs).toBe(0);
    expect(clock.currentTick).toBe(0);
    expect(clock.tickMs).toBe(50);

    clock.advanceTicks(4);
    expect(clock.nowMs).toBe(200);
    expect(clock.currentTick).toBe(4);

    clock.advanceBy(30);
    expect(clock.nowMs).toBe(230);
    expect(clock.currentTick).toBe(4);

    clock.advanceTo(1_000);
    expect(clock.nowMs).toBe(1_000);
    expect(clock.currentTick).toBe(20);
  });

  it("rejects backward jumps and invalid deltas without mutating current time", () => {
    const clock = new FakeGameClock({ startMs: 500, tickMs: 50 });
    const wallBefore = clock.wallClockEpochMs;

    expectDomainError(() => clock.advanceTo(400), DomainErrorCode.ERR_CLOCK_BACKWARD_JUMP);
    expectDomainError(() => clock.advanceBy(-10), DomainErrorCode.ERR_INVALID_TIME_DELTA);
    expectDomainError(() => clock.advanceBy(12.5), DomainErrorCode.ERR_INVALID_TIME_DELTA);
    expectDomainError(() => clock.advanceBy(Number.NaN), DomainErrorCode.ERR_INVALID_TIME_DELTA);
    expectDomainError(
      () => clock.advanceBy(Number.POSITIVE_INFINITY),
      DomainErrorCode.ERR_INVALID_TIME_DELTA,
    );
    expectDomainError(() => clock.advanceTicks(-1), DomainErrorCode.ERR_INVALID_TIME_DELTA);
    expectDomainError(() => clock.advanceTicks(1.5), DomainErrorCode.ERR_INVALID_TIME_DELTA);
    expectDomainError(() => clock.advanceTo(-5), DomainErrorCode.ERR_INVALID_TIME_DELTA);

    expect(clock.nowMs).toBe(500);
    expect(clock.currentTick).toBe(10);
    expect(clock.wallClockEpochMs).toBe(wallBefore);
  });

  it("snapshots and restores exact clock state and rejects malformed snapshots/options", () => {
    const clock = new FakeGameClock({ startMs: 15_000, tickMs: 50 });
    const snap = clock.snapshot();
    expect(GameClockSnapshotValidator.Check(snap)).toBe(true);

    clock.advanceTo(25_000);
    expect(clock.nowMs).toBe(25_000);
    expect(clock.currentTick).toBe(500);

    clock.restore(snap);
    expect(clock.nowMs).toBe(15_000);
    expect(clock.currentTick).toBe(300);
    expect(clock.wallClockEpochMs).toBe(snap.wallClockEpochMs);

    expectDomainError(
      () => clock.restore({ nowMs: -1, tickMs: 50, wallClockEpochMs: 0 }),
      DomainErrorCode.ERR_INVALID_TIME_DELTA,
    );
    expectDomainError(
      () => new FakeGameClock({ startMs: -1 }),
      DomainErrorCode.ERR_INVALID_TIME_DELTA,
    );
    expectDomainError(
      () => new FakeGameClock({ tickMs: 0 }),
      DomainErrorCode.ERR_INVALID_TIME_DELTA,
    );
  });
});
