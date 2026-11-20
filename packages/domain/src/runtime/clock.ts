import { Type, type Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { DomainError, DomainErrorCode } from "../errors/domain-error.js";

export const DEFAULT_SIM_TICK_MS = 50 as const;
export const DEFAULT_MAX_TICK_DELTA_MS = 250 as const;

export interface GameClock {
  readonly nowMs: number;
  readonly currentTick: number;
  readonly tickMs: number;
  readonly wallClockEpochMs: number;
}

export interface LatchableGameClock extends GameClock {
  latch(): number;
  snapshot(): GameClockSnapshot;
}

export const GameClockSnapshotSchema = Type.Object(
  {
    nowMs: Type.Integer({ minimum: 0 }),
    tickMs: Type.Integer({ minimum: 1 }),
    wallClockEpochMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type GameClockSnapshot = Static<typeof GameClockSnapshotSchema>;

export const GameClockSnapshotValidator = TypeCompiler.Compile(GameClockSnapshotSchema);

export interface SystemGameClockOptions {
  readonly tickMs?: number;
  readonly maxTickDeltaMs?: number;
  readonly startNowMs?: number;
  readonly monotonicSource?: () => number;
  readonly wallClockSource?: () => number;
  readonly onDrift?: (droppedMs: number) => void;
}

export function assertNonNegativeIntegerMs(value: number, fieldPath: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_TIME_DELTA,
      `Invalid time value for "${fieldPath}": expected non-negative integer ms, got ${String(value)}`,
      { fieldPath, details: { value } },
    );
  }
  return value;
}

export function assertPositiveIntegerMs(value: number, fieldPath: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_TIME_DELTA,
      `Invalid positive time parameter "${fieldPath}": expected integer >= 1 ms, got ${String(value)}`,
      { fieldPath, details: { value } },
    );
  }
  return value;
}
