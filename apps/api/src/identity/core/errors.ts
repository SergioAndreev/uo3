import { IDENTITY_ERRORS, type IdentityErrorCode } from '@duskmarch/protocol';

/** Ошибка identity с кодом из реестра протокола. */
export class IdentityError extends Error {
  override readonly name = 'IdentityError';
  readonly status: number;

  constructor(
    readonly code: IdentityErrorCode,
    message: string = code,
    readonly options: {
      status?: number;
      details?: Record<string, unknown>;
      /** Секунды для заголовка `Retry-After`. */
      retryAfterS?: number;
      /** Очистить cookie refresh в ответе. */
      clearRefresh?: boolean;
    } = {},
  ) {
    super(message);
    this.status = options.status ?? IDENTITY_ERRORS[code];
  }
}

export const fail = (...args: ConstructorParameters<typeof IdentityError>): never => {
  throw new IdentityError(...args);
};
