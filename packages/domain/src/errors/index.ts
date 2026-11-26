/** Коды доменных ошибок; строки стабильны и попадают в протокол и журналы. */
export const DOMAIN_ERROR_CODES = [
  'ERR_INVALID_ENTITY_ID',
  'ERR_ENTITY_KIND_MISMATCH',
  'ERR_RESERVED_ENTITY_ID',
  'ERR_ENTITY_ID_COLLISION',
  'ERR_ENTITY_ID_EXHAUSTED',
  'ERR_INVALID_LEASE_SIZE',
  'ERR_ID_LEASE_PENDING',
  'ERR_INVALID_COORDINATE',
  'ERR_HEIGHT_OUT_OF_RANGE',
  'ERR_OUT_OF_REALM_BOUNDS',
  'ERR_UNKNOWN_REALM',
  'ERR_REALM_MISMATCH',
  'ERR_SKILL_VALUE_OUT_OF_RANGE',
  'ERR_INVALID_TONE_SET',
  'ERR_UNKNOWN_CELL_FLAG',
  'ERR_INVALID_CONTENT_KEY',
  'ERR_INVALID_TINT',
  'ERR_UNKNOWN_FEATURE_FLAG',
  'ERR_RULESET_INVARIANT',
  'ERR_RULESET_SCHEMA',
  'ERR_CLOCK_REGRESSION',
  'ERR_INVALID_DICE',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export interface DomainErrorOptions {
  /** Путь поля, например `movement.runMs`. */
  fieldPath?: string;
  details?: Readonly<Record<string, unknown>>;
}

export class DomainError extends Error {
  override readonly name = 'DomainError';
  readonly code: DomainErrorCode;
  readonly fieldPath: string | undefined;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: DomainErrorCode, message: string, options: DomainErrorOptions = {}) {
    super(`${code}: ${message}`);
    this.code = code;
    this.fieldPath = options.fieldPath;
    this.details = Object.freeze({ ...options.details });
  }

  toJSON(): { code: DomainErrorCode; message: string; fieldPath?: string; details: object } {
    return {
      code: this.code,
      message: this.message,
      ...(this.fieldPath === undefined ? {} : { fieldPath: this.fieldPath }),
      details: this.details,
    };
  }
}

export const isDomainError = (value: unknown, code?: DomainErrorCode): value is DomainError =>
  value instanceof DomainError && (code === undefined || value.code === code);
