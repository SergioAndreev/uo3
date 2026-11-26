export type WorldErrorCode =
  | 'WORLD_CHUNK_HASH'
  | 'WORLD_CHUNK_MISSING'
  | 'WORLD_UNKNOWN_OBJECT'
  | 'WORLD_SCHEMA'
  | 'PATCH_INVALID'
  | 'PATCH_BASE_MISMATCH'
  | 'PATCH_CONFLICT';

export class WorldError extends Error {
  override readonly name = 'WorldError';
  constructor(
    readonly code: WorldErrorCode | string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(`${code}: ${message}`);
  }
}
