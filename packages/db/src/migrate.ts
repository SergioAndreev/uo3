import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DbEnvSchema, loadServerConfigOrExit } from "@uo3/config/env/server";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDbClient } from "./client.js";

export const DEFAULT_MIGRATIONS_FOLDER = resolve(import.meta.dirname, "../drizzle");

export async function runMigrations(
  databaseUrl: string,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): Promise<void> {
  const client = createDbClient(databaseUrl, { max: 1 });
  try {
    await migrate(client.db, { migrationsFolder });
  } finally {
    await client.close();
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const config = loadServerConfigOrExit(DbEnvSchema, {
    appName: "db:migrate",
    cwd: resolve(import.meta.dirname, "../../.."),
  });
  runMigrations(config.DATABASE_URL)
    .then(() => {
      process.stdout.write("PostgreSQL migrations applied successfully.\n");
    })
    .catch((err: unknown) => {
      process.stderr.write(
        `Migration failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    });
}
