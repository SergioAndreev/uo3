export const DomainErrorCode = {
  // Identity (domain/entity-identity)
  ERR_INVALID_SERIAL: "ERR_INVALID_SERIAL",
  ERR_SERIAL_KIND_MISMATCH: "ERR_SERIAL_KIND_MISMATCH",
  ERR_SERIAL_COLLISION: "ERR_SERIAL_COLLISION",
  ERR_SERIAL_RANGE_EXHAUSTED: "ERR_SERIAL_RANGE_EXHAUSTED",
  ERR_INVALID_LEASE_SIZE: "ERR_INVALID_LEASE_SIZE",
  ERR_RESERVED_SERIAL: "ERR_RESERVED_SERIAL",

  // Coordinates (domain/world-coordinates)
  ERR_INVALID_COORDINATE: "ERR_INVALID_COORDINATE",
  ERR_Z_OUT_OF_RANGE: "ERR_Z_OUT_OF_RANGE",
  ERR_UNKNOWN_FACET: "ERR_UNKNOWN_FACET",
  ERR_INVALID_FACET_DIMENSIONS: "ERR_INVALID_FACET_DIMENSIONS",
  ERR_OUT_OF_MAP_BOUNDS: "ERR_OUT_OF_MAP_BOUNDS",
  ERR_UNALIGNED_PARTITION_BOUNDS: "ERR_UNALIGNED_PARTITION_BOUNDS",
  ERR_INVALID_DIRECTION: "ERR_INVALID_DIRECTION",
  ERR_FACET_MISMATCH: "ERR_FACET_MISMATCH",

  // Enumerations (domain/core-enumerations)
  ERR_INVALID_LAYER: "ERR_INVALID_LAYER",
  ERR_INVALID_BODY: "ERR_INVALID_BODY",
  ERR_INVALID_HUE: "ERR_INVALID_HUE",
  ERR_HUE_OUT_OF_ALLOWED_RANGE: "ERR_HUE_OUT_OF_ALLOWED_RANGE",
  ERR_INVALID_NOTORIETY: "ERR_INVALID_NOTORIETY",
  ERR_INVALID_ACCESS_LEVEL: "ERR_INVALID_ACCESS_LEVEL",
  ERR_RACE_DISABLED_IN_ERA: "ERR_RACE_DISABLED_IN_ERA",
  ERR_INVALID_GENDER: "ERR_INVALID_GENDER",
  ERR_INVALID_GRAPHIC_ID: "ERR_INVALID_GRAPHIC_ID",
  ERR_INVALID_TILE_FLAGS: "ERR_INVALID_TILE_FLAGS",
  ERR_INVALID_SKILL_ID: "ERR_INVALID_SKILL_ID",
  ERR_INVALID_STAT_ID: "ERR_INVALID_STAT_ID",
  ERR_INVALID_LOCK_STATE: "ERR_INVALID_LOCK_STATE",

  // Ruleset (domain/ruleset-profile)
  ERR_UNKNOWN_FEATURE_FLAG: "ERR_UNKNOWN_FEATURE_FLAG",
  ERR_RULESET_UNKNOWN_KEY: "ERR_RULESET_UNKNOWN_KEY",
  ERR_RULESET_INVARIANT_VIOLATION: "ERR_RULESET_INVARIANT_VIOLATION",
  ERR_UNKNOWN_RULESET_PRESET: "ERR_UNKNOWN_RULESET_PRESET",
  ERR_NON_PROD_PRESET_FORBIDDEN: "ERR_NON_PROD_PRESET_FORBIDDEN",
  ERR_INVALID_STAT_VALUE: "ERR_INVALID_STAT_VALUE",

  // Deterministic Runtime (domain/deterministic-runtime)
  ERR_CLOCK_BACKWARD_JUMP: "ERR_CLOCK_BACKWARD_JUMP",
  ERR_INVALID_TIME_DELTA: "ERR_INVALID_TIME_DELTA",
  ERR_INVALID_RNG_SEED: "ERR_INVALID_RNG_SEED",
  ERR_INVALID_RANGE: "ERR_INVALID_RANGE",
  ERR_INVALID_PROBABILITY: "ERR_INVALID_PROBABILITY",
  ERR_EMPTY_COLLECTION: "ERR_EMPTY_COLLECTION",
  ERR_INVALID_WEIGHT: "ERR_INVALID_WEIGHT",
  ERR_INVALID_RNG_STATE: "ERR_INVALID_RNG_STATE",
  ERR_INVALID_GAME_TIME_PARAM: "ERR_INVALID_GAME_TIME_PARAM",
} as const;

export type DomainErrorCode = (typeof DomainErrorCode)[keyof typeof DomainErrorCode];

export interface DomainErrorOptions {
  readonly fieldPath?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export interface SerializedDomainError {
  readonly name: "DomainError";
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly fieldPath?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export class DomainError extends Error {
  public readonly code: DomainErrorCode;
  public readonly fieldPath: string | undefined;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

  public constructor(code: DomainErrorCode, message: string, options: DomainErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "DomainError";
    this.code = code;
    this.fieldPath = options.fieldPath;
    this.details = options.details;
  }

  public toJSON(): SerializedDomainError {
    return {
      name: "DomainError",
      code: this.code,
      message: this.message,
      ...(this.fieldPath !== undefined ? { fieldPath: this.fieldPath } : {}),
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export function isDomainError(
  value: unknown,
  expectedCode?: DomainErrorCode,
): value is DomainError {
  if (!(value instanceof DomainError)) {
    return false;
  }
  return expectedCode === undefined || value.code === expectedCode;
}
