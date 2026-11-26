/** Ошибки ядра симуляции. */
export const ENGINE_ERRORS = [
  'SCHEDULER_INVALID_DELAY',
  'SCHEDULER_INGRESS_OVERFLOW',
  'PARTITION_INVALID_BOUNDS',
  'PARTITION_HYDRATION_FAILED',
  'PARTITION_ENTITY_OUT_OF_BOUNDS',
  'ERR_ENTITY_ID_COLLISION',
  'PARTITION_PLACEMENT_INVALID',
  'HUB_ANNOUNCEMENT_FORBIDDEN',
  'HUB_ANNOUNCEMENT_RATE_LIMITED',
  'HUB_ANNOUNCEMENT_INVALID',
  'HARNESS_WAIT_TIMEOUT',
  'ERR_INVALID_TIME_DELTA',
  'HARNESS_DETERMINISM_VIOLATION',
] as const;
export type EngineErrorCode = (typeof ENGINE_ERRORS)[number];

export class EngineError extends Error {
  override readonly name = 'EngineError';
  constructor(
    readonly code: EngineErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}
