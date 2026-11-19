import { ENV_SERVER_MODULE_ID } from "@uo3/config/env/server";
import { PACKAGE_ID as DOMAIN_PACKAGE_ID } from "@uo3/domain";

export const PACKAGE_ID = "@uo3/db" as const;

export function getDbPackageIdentity(): {
  readonly id: string;
  readonly domainId: string;
  readonly configId: string;
} {
  return {
    id: PACKAGE_ID,
    domainId: DOMAIN_PACKAGE_ID,
    configId: ENV_SERVER_MODULE_ID,
  };
}

export {
  checkDbHealth,
  createDbClient,
  type DbClientHandle,
  type DbHealthResult,
  type DbSchema,
  type DrizzleDb,
} from "./client.js";
export { DEFAULT_MIGRATIONS_FOLDER, runMigrations } from "./migrate.js";
export {
  platformEnvMetadata,
  type NewPlatformEnvMetadataRow,
  type PlatformEnvMetadataRow,
} from "./schema/index.js";
export {
  buildSeedRows,
  INITIAL_PLATFORM_SEED_ENTRIES,
  seedDatabase,
  type PlatformSeedEntry,
} from "./seed.js";
