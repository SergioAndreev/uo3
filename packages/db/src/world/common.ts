import type { Database } from '../client.js';
import { worldEntities } from '../schema/index.js';

/** Ошибка хранилища мира с кодом `PERSIST_*` (сопоставляется с `PersistError` протокола). */
export class WorldStoreError extends Error {
  constructor(
    readonly code: string,
    message: string = code,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'WorldStoreError';
  }
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Tx;
export type WorldRow = typeof worldEntities.$inferSelect;
