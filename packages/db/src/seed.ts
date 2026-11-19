import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DbEnvSchema, loadServerConfigOrExit } from "@uo3/config/env/server";
import { sql } from "drizzle-orm";
import { createDbClient, type DrizzleDb } from "./client.js";
import { platformEnvMetadata, type NewPlatformEnvMetadataRow } from "./schema/index.js";

export interface PlatformSeedEntry {
  readonly key: string;
  readonly value: unknown;
  readonly description: string;
}

export const INITIAL_PLATFORM_SEED_ENTRIES: readonly PlatformSeedEntry[] = Object.freeze([
  {
    key: "seed.version",
    value: "p00-v1",
    description: "Версия детерминированного начального наполнения среды P00",
  },
  {
    key: "shard.default",
    value: { id: "local-dev", name: "UO3 Local Dev", era: "uo-r" },
    description: "Метаданные локального шарда разработки по умолчанию",
  },
  {
    key: "world.synthetic_ready",
    value: false,
    description: "Признак готовности синтетического мира (заполняется в P02)",
  },
]);

export function buildSeedRows(
  entries: readonly PlatformSeedEntry[] = INITIAL_PLATFORM_SEED_ENTRIES,
): NewPlatformEnvMetadataRow[] {
  return entries.map((entry) => ({
    key: entry.key,
    value: entry.value,
    description: entry.description,
  }));
}

export async function seedDatabase(
  db: DrizzleDb,
  entries: readonly PlatformSeedEntry[] = INITIAL_PLATFORM_SEED_ENTRIES,
): Promise<number> {
  const rows = buildSeedRows(entries);
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .insert(platformEnvMetadata)
        .values(row)
        .onConflictDoUpdate({
          target: platformEnvMetadata.key,
          set: {
            value: row.value,
            description: row.description,
            updatedAt: sql`now()`,
          },
        });
    }
  });
  return rows.length;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const config = loadServerConfigOrExit(DbEnvSchema, {
    appName: "db:seed",
    cwd: resolve(import.meta.dirname, "../../.."),
  });
  const client = createDbClient(config.DATABASE_URL, { max: 2 });
  seedDatabase(client.db)
    .then(async (count) => {
      process.stdout.write(`Database seeded idempotently (${count} metadata entries).\n`);
      await client.close();
    })
    .catch(async (err: unknown) => {
      process.stderr.write(`Seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
      await client.close();
      process.exit(1);
    });
}
