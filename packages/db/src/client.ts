import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

export type DbSchema = typeof schema;
export type DrizzleDb = NodePgDatabase<DbSchema>;

export interface DbClientHandle {
  readonly pool: Pool;
  readonly db: DrizzleDb;
  readonly close: () => Promise<void>;
}

export interface DbHealthResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly error?: string;
}

export function createDbClient(
  databaseUrl: string,
  options: { readonly max?: number; readonly connectionTimeoutMillis?: number } = {},
): DbClientHandle {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
  });
  const db = drizzle(pool, { schema });

  return {
    pool,
    db,
    close: async () => {
      await pool.end();
    },
  };
}

export async function checkDbHealth(
  db: Pick<DrizzleDb, "execute">,
  timeoutMs = 500,
): Promise<DbHealthResult> {
  const startedAt = Date.now();
  let timer: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`PostgreSQL healthcheck timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);

    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
