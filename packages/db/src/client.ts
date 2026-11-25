import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbClient {
  db: Database;
  close: () => Promise<void>;
}

export function createDbClient(databaseUrl: string): DbClient {
  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
  // Без обработчика обрыв простаивающего соединения завершает процесс.
  pool.on('error', () => undefined);
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

/** Проверяет подключение; никогда не бросает исключение. */
export async function checkDbHealth(
  db: Pick<Database, 'execute'>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const probe = (async () => {
    await db.execute(sql`select 1`);
    return true;
  })().catch(() => false);
  try {
    return await Promise.race([probe, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
