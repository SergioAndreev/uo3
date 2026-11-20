import { describe, expect, it } from "vitest";
import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import {
  computeDayPhase,
  computeGameTime,
  computeGlobalLightLevel,
  computeMoonPhases,
  DayPhase,
  DEFAULT_GAME_HOUR_REAL_MS,
  GAME_MINUTES_PER_DAY,
  gameDurationToRealMs,
  msUntilGameHour,
} from "./game-time.js";

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

describe("domain/deterministic-runtime — UO Game Time, Light Curve & Moon Phases", () => {
  it("computes canonical UO game time (1 game hour = 300,000 ms) and rejects invalid params", () => {
    const t0 = computeGameTime(0);
    expect({ day: t0.day, hour: t0.hour, minute: t0.minute }).toEqual({
      day: 0,
      hour: 0,
      minute: 0,
    });

    const t1 = computeGameTime(300_000);
    expect({ day: t1.day, hour: t1.hour, minute: t1.minute }).toEqual({
      day: 0,
      hour: 1,
      minute: 0,
    });

    const t12 = computeGameTime(3_600_000);
    expect({ day: t12.day, hour: t12.hour, minute: t12.minute }).toEqual({
      day: 0,
      hour: 12,
      minute: 0,
    });
    expect(t12.dayPhase).toBe(DayPhase.Day);
    expect(t12.globalLightLevel).toBe(0);

    const t24 = computeGameTime(7_200_000);
    expect({ day: t24.day, hour: t24.hour, minute: t24.minute }).toEqual({
      day: 1,
      hour: 0,
      minute: 0,
    });

    // Epoch offset support
    const withOffset = computeGameTime(0, { shardEpochOffsetMs: 3_600_000 });
    expect(withOffset.hour).toBe(12);

    expectDomainError(() => computeGameTime(-1), DomainErrorCode.ERR_INVALID_GAME_TIME_PARAM);
    expectDomainError(
      () => computeGameTime(0, { gameHourRealMs: 0 }),
      DomainErrorCode.ERR_INVALID_GAME_TIME_PARAM,
    );
    expectDomainError(
      () => computeGameTime(0, { shardEpochOffsetMs: -5 }),
      DomainErrorCode.ERR_INVALID_GAME_TIME_PARAM,
    );
  });

  it("converts game durations and computes msUntilGameHour across midnight", () => {
    expect(gameDurationToRealMs({ hours: 5, minutes: 30 })).toBe(1_650_000);
    expect(gameDurationToRealMs({ days: 1 })).toBe(7_200_000);

    // 22:30 -> 04:00 is 5h 30m = 1,650,000 ms
    const msAt2230 = gameDurationToRealMs({ hours: 22, minutes: 30 });
    const waitMs = msUntilGameHour(msAt2230, 4);
    expect(waitMs).toBe(1_650_000);

    const next = computeGameTime(msAt2230 + waitMs);
    expect(next.day).toBe(1);
    expect(next.hour).toBe(4);
    expect(next.minute).toBe(0);

    // Exact boundary wrap (04:00 -> next 04:00 = full 24 game hours = 7,200,000 ms)
    const at0400 = gameDurationToRealMs({ hours: 4 });
    expect(msUntilGameHour(at0400, 4)).toBe(7_200_000);

    expectDomainError(() => msUntilGameHour(0, 24), DomainErrorCode.ERR_INVALID_GAME_TIME_PARAM);
    expectDomainError(() => msUntilGameHour(0, -1), DomainErrorCode.ERR_INVALID_GAME_TIME_PARAM);
    expectDomainError(
      () => gameDurationToRealMs({ hours: -1 }),
      DomainErrorCode.ERR_INVALID_GAME_TIME_PARAM,
    );
  });

  it("computes DayPhase across all 24 hours and global light curve across all 1,440 minutes", () => {
    // Key checkpoints
    expect(computeDayPhase(0)).toBe(DayPhase.Night);
    expect(computeDayPhase(3)).toBe(DayPhase.Night);
    expect(computeDayPhase(4)).toBe(DayPhase.Dawn);
    expect(computeDayPhase(5)).toBe(DayPhase.Dawn);
    expect(computeDayPhase(6)).toBe(DayPhase.Day);
    expect(computeDayPhase(19)).toBe(DayPhase.Day);
    expect(computeDayPhase(20)).toBe(DayPhase.Dusk);
    expect(computeDayPhase(21)).toBe(DayPhase.Dusk);
    expect(computeDayPhase(22)).toBe(DayPhase.Night);
    expect(computeDayPhase(23)).toBe(DayPhase.Night);

    expect(computeGlobalLightLevel(12 * 60)).toBe(0); // 12:00
    expect(computeGlobalLightLevel(0)).toBe(26); // 00:00
    expect(computeGlobalLightLevel(5 * 60)).toBe(13); // 05:00 mid-dawn
    expect(computeGlobalLightLevel(21 * 60)).toBe(13); // 21:00 mid-dusk

    // Full 1,440-minute sweep: bounds, continuity, monotonicity, consistency with computeGameTime
    const minuteMs = DEFAULT_GAME_HOUR_REAL_MS / 60;
    for (let m = 0; m < GAME_MINUTES_PER_DAY; m++) {
      const light = computeGlobalLightLevel(m);
      expect(light).toBeGreaterThanOrEqual(0);
      expect(light).toBeLessThanOrEqual(26);

      const gt = computeGameTime(m * minuteMs);
      expect(gt.minuteOfDay).toBe(m);
      expect(gt.globalLightLevel).toBe(light);
      expect(gt.dayPhase).toBe(computeDayPhase(Math.floor(m / 60)));

      // Monotonic decrease during Dawn (04:00..06:00)
      if (m > 240 && m <= 360) {
        expect(light).toBeLessThanOrEqual(computeGlobalLightLevel(m - 1));
      }
      // Monotonic increase during Dusk (20:00..22:00)
      if (m > 1200 && m <= 1320) {
        expect(light).toBeGreaterThanOrEqual(computeGlobalLightLevel(m - 1));
      }

      // Consistency with msUntilGameHour for next hour boundary
      const nextHour = (Math.floor(m / 60) + 1) % 24;
      const wait = msUntilGameHour(m * minuteMs, nextHour);
      const arrived = computeGameTime(m * minuteMs + wait);
      expect(arrived.hour).toBe(nextHour);
      expect(arrived.minute).toBe(0);
    }

    expectDomainError(() => computeDayPhase(24), DomainErrorCode.ERR_INVALID_GAME_TIME_PARAM);
    expectDomainError(
      () => computeGlobalLightLevel(-1),
      DomainErrorCode.ERR_INVALID_GAME_TIME_PARAM,
    );
    expectDomainError(
      () => computeGlobalLightLevel(1440),
      DomainErrorCode.ERR_INVALID_GAME_TIME_PARAM,
    );
  });

  it("computes 8-phase moon cycles for Trammel (period 8d) and Felucca (period 24d)", () => {
    const d0 = computeMoonPhases(0);
    const d8 = computeMoonPhases(8);
    const d16 = computeMoonPhases(16);
    const d24 = computeMoonPhases(24);

    expect(d0).toEqual({ trammelPhase: 0, feluccaPhase: 0 });
    expect(d8.trammelPhase).toBe(d0.trammelPhase);
    expect(d8.feluccaPhase).not.toBe(d0.feluccaPhase);
    expect(d16.trammelPhase).toBe(d0.trammelPhase);
    expect(d24).toEqual(d0);

    for (let day = 0; day < 48; day++) {
      const m = computeMoonPhases(day);
      expect(m.trammelPhase).toBeGreaterThanOrEqual(0);
      expect(m.trammelPhase).toBeLessThanOrEqual(7);
      expect(m.feluccaPhase).toBeGreaterThanOrEqual(0);
      expect(m.feluccaPhase).toBeLessThanOrEqual(7);
      expect(computeMoonPhases(day + 8).trammelPhase).toBe(m.trammelPhase);
      expect(computeMoonPhases(day + 24).feluccaPhase).toBe(m.feluccaPhase);
    }

    expectDomainError(() => computeMoonPhases(-1), DomainErrorCode.ERR_INVALID_GAME_TIME_PARAM);
  });
});
