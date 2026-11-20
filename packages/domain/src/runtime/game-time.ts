import { DomainError, DomainErrorCode } from "../errors/domain-error.js";

export const DEFAULT_GAME_HOUR_REAL_MS = 300_000 as const;
export const GAME_HOURS_PER_DAY = 24 as const;
export const GAME_MINUTES_PER_HOUR = 60 as const;
export const GAME_MINUTES_PER_DAY = 1_440 as const;
export const DAY_LIGHT_LEVEL = 0 as const;
export const NIGHT_LIGHT_LEVEL = 26 as const;
export const TRAMMEL_CYCLE_DAYS = 8 as const;
export const FELUCCA_CYCLE_DAYS = 24 as const;
export const MOON_PHASE_COUNT = 8 as const;

export const DayPhase = {
  Night: "Night",
  Dawn: "Dawn",
  Day: "Day",
  Dusk: "Dusk",
} as const;

export type DayPhase = (typeof DayPhase)[keyof typeof DayPhase];

export interface GameTimeOptions {
  readonly gameHourRealMs?: number;
  readonly shardEpochOffsetMs?: number;
}

export interface MoonPhases {
  readonly trammelPhase: number;
  readonly feluccaPhase: number;
}

export interface GameTime {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly minuteOfDay: number;
  readonly dayPhase: DayPhase;
  readonly globalLightLevel: number;
  readonly trammelPhase: number;
  readonly feluccaPhase: number;
}

export interface GameDuration {
  readonly days?: number;
  readonly hours?: number;
  readonly minutes?: number;
}

function assertNonNegativeFinite(value: number, fieldPath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_GAME_TIME_PARAM,
      `Invalid game time parameter "${fieldPath}": expected finite number >= 0, got ${String(value)}`,
      { fieldPath, details: { value } },
    );
  }
  return value;
}

function assertPositiveFinite(value: number, fieldPath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_GAME_TIME_PARAM,
      `Invalid game time parameter "${fieldPath}": expected finite number > 0, got ${String(value)}`,
      { fieldPath, details: { value } },
    );
  }
  return value;
}

export function computeDayPhase(hour: number): DayPhase {
  if (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_GAME_TIME_PARAM,
      `Invalid game hour: expected integer 0..23, got ${String(hour)}`,
      { fieldPath: "hour", details: { hour } },
    );
  }
  if (hour >= 4 && hour < 6) {
    return DayPhase.Dawn;
  }
  if (hour >= 6 && hour < 20) {
    return DayPhase.Day;
  }
  if (hour >= 20 && hour < 22) {
    return DayPhase.Dusk;
  }
  return DayPhase.Night;
}

export function computeGlobalLightLevel(minuteOfDay: number): number {
  if (
    typeof minuteOfDay !== "number" ||
    !Number.isInteger(minuteOfDay) ||
    minuteOfDay < 0 ||
    minuteOfDay >= GAME_MINUTES_PER_DAY
  ) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_GAME_TIME_PARAM,
      `Invalid minuteOfDay: expected integer 0..1439, got ${String(minuteOfDay)}`,
      { fieldPath: "minuteOfDay", details: { minuteOfDay } },
    );
  }

  // Day: 06:00 (360) .. 19:59 (1199) => 0 (brightest)
  if (minuteOfDay >= 360 && minuteOfDay < 1200) {
    return DAY_LIGHT_LEVEL;
  }

  // Dawn: 04:00 (240) .. 05:59 (359) => linear 26 -> 0 over 120 minutes
  if (minuteOfDay >= 240 && minuteOfDay < 360) {
    return Math.round((NIGHT_LIGHT_LEVEL * (360 - minuteOfDay)) / 120);
  }

  // Dusk: 20:00 (1200) .. 21:59 (1319) => linear 0 -> 26 over 120 minutes
  if (minuteOfDay >= 1200 && minuteOfDay < 1320) {
    return Math.round((NIGHT_LIGHT_LEVEL * (minuteOfDay - 1200)) / 120);
  }

  // Night: 22:00 (1320) .. 03:59 (239) => 26 (darkest)
  return NIGHT_LIGHT_LEVEL;
}

export function computeMoonPhases(day: number): MoonPhases {
  if (typeof day !== "number" || !Number.isInteger(day) || day < 0) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_GAME_TIME_PARAM,
      `Invalid game day: expected integer >= 0, got ${String(day)}`,
      { fieldPath: "day", details: { day } },
    );
  }

  return {
    trammelPhase: day % TRAMMEL_CYCLE_DAYS,
    feluccaPhase: Math.floor((day % FELUCCA_CYCLE_DAYS) / (FELUCCA_CYCLE_DAYS / MOON_PHASE_COUNT)),
  };
}

export function computeGameTime(elapsedRealMs: number, options: GameTimeOptions = {}): GameTime {
  const elapsed = assertNonNegativeFinite(elapsedRealMs, "elapsedRealMs");
  const gameHourRealMs = assertPositiveFinite(
    options.gameHourRealMs ?? DEFAULT_GAME_HOUR_REAL_MS,
    "gameHourRealMs",
  );
  const epochOffset = assertNonNegativeFinite(
    options.shardEpochOffsetMs ?? 0,
    "shardEpochOffsetMs",
  );

  const effectiveRealMs = elapsed + epochOffset;
  const totalGameMinutes = Math.floor((effectiveRealMs * GAME_MINUTES_PER_HOUR) / gameHourRealMs);
  const day = Math.floor(totalGameMinutes / GAME_MINUTES_PER_DAY);
  const minuteOfDay = totalGameMinutes % GAME_MINUTES_PER_DAY;
  const hour = Math.floor(minuteOfDay / GAME_MINUTES_PER_HOUR);
  const minute = minuteOfDay % GAME_MINUTES_PER_HOUR;

  const dayPhase = computeDayPhase(hour);
  const globalLightLevel = computeGlobalLightLevel(minuteOfDay);
  const { trammelPhase, feluccaPhase } = computeMoonPhases(day);

  return {
    day,
    hour,
    minute,
    minuteOfDay,
    dayPhase,
    globalLightLevel,
    trammelPhase,
    feluccaPhase,
  };
}

export function gameDurationToRealMs(
  duration: GameDuration,
  gameHourRealMs: number = DEFAULT_GAME_HOUR_REAL_MS,
): number {
  const hourMs = assertPositiveFinite(gameHourRealMs, "gameHourRealMs");
  const days = assertNonNegativeFinite(duration.days ?? 0, "duration.days");
  const hours = assertNonNegativeFinite(duration.hours ?? 0, "duration.hours");
  const minutes = assertNonNegativeFinite(duration.minutes ?? 0, "duration.minutes");

  const totalMinutes = days * GAME_MINUTES_PER_DAY + hours * GAME_MINUTES_PER_HOUR + minutes;
  return Math.round((totalMinutes * hourMs) / GAME_MINUTES_PER_HOUR);
}

export function msUntilGameHour(
  currentRealMs: number,
  targetHour: number,
  options: GameTimeOptions = {},
): number {
  const elapsed = assertNonNegativeFinite(currentRealMs, "currentRealMs");
  const gameHourRealMs = assertPositiveFinite(
    options.gameHourRealMs ?? DEFAULT_GAME_HOUR_REAL_MS,
    "gameHourRealMs",
  );
  const epochOffset = assertNonNegativeFinite(
    options.shardEpochOffsetMs ?? 0,
    "shardEpochOffsetMs",
  );

  if (
    typeof targetHour !== "number" ||
    !Number.isInteger(targetHour) ||
    targetHour < 0 ||
    targetHour >= GAME_HOURS_PER_DAY
  ) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_GAME_TIME_PARAM,
      `Invalid targetHour: expected integer 0..23, got ${String(targetHour)}`,
      { fieldPath: "targetHour", details: { targetHour } },
    );
  }

  const dayRealMs = gameHourRealMs * GAME_HOURS_PER_DAY;
  const effectiveMs = elapsed + epochOffset;
  const msIntoDay = effectiveMs % dayRealMs;
  const targetMsIntoDay = targetHour * gameHourRealMs;
  let delta = targetMsIntoDay - msIntoDay;
  if (delta <= 0) {
    delta += dayRealMs;
  }
  return delta;
}
