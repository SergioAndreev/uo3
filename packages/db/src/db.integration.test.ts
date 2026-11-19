import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { checkDbHealth, createDbClient } from "./client.js";
import { runMigrations } from "./migrate.js";
import { platformEnvMetadata } from "./schema/index.js";
import { INITIAL_PLATFORM_SEED_ENTRIES, seedDatabase } from "./seed.js";

const TEST_DB_URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://uo3:CHANGE_ME_LOCAL_DEV_ONLY@localhost:5432/uo3_test";

const DEV_DB_URL =
  process.env["DATABASE_URL"] ?? "postgresql://uo3:CHANGE_ME_LOCAL_DEV_ONLY@localhost:5432/uo3_dev";

describe("@uo3/db PostgreSQL integration tests (uo3_test isolation)", () => {
  it("applies migrations, runs idempotent seed twice, and preserves uo3_dev data", async () => {
    const devMarkerKey = "test.isolation.dev_marker";

    // Prepare uo3_dev with a marker record to ensure test runs never alter uo3_dev
    await runMigrations(DEV_DB_URL);
    const devClient = createDbClient(DEV_DB_URL, { max: 2 });
    try {
      await devClient.db
        .insert(platformEnvMetadata)
        .values({
          key: devMarkerKey,
          value: { preserved: true },
          description: "Dev isolation marker",
        })
        .onConflictDoUpdate({
          target: platformEnvMetadata.key,
          set: { value: { preserved: true } },
        });
    } finally {
      await devClient.close();
    }

    // Run migrations and seed twice against uo3_test
    await runMigrations(TEST_DB_URL);
    const testClient = createDbClient(TEST_DB_URL, { max: 2 });
    try {
      const health = await checkDbHealth(testClient.db, 500);
      expect(health.ok, health.error).toBe(true);

      const firstCount = await seedDatabase(testClient.db);
      expect(firstCount).toBe(INITIAL_PLATFORM_SEED_ENTRIES.length);

      const rowsAfterFirst = await testClient.db
        .select({ key: platformEnvMetadata.key, value: platformEnvMetadata.value })
        .from(platformEnvMetadata)
        .orderBy(asc(platformEnvMetadata.key));

      const secondCount = await seedDatabase(testClient.db);
      expect(secondCount).toBe(INITIAL_PLATFORM_SEED_ENTRIES.length);

      const rowsAfterSecond = await testClient.db
        .select({ key: platformEnvMetadata.key, value: platformEnvMetadata.value })
        .from(platformEnvMetadata)
        .orderBy(asc(platformEnvMetadata.key));

      expect(rowsAfterSecond).toEqual(rowsAfterFirst);
      expect(rowsAfterSecond.some((r) => r.key === "seed.version")).toBe(true);
    } finally {
      await testClient.close();
    }

    // Confirm uo3_dev marker is still intact and clean it up
    const verifyDevClient = createDbClient(DEV_DB_URL, { max: 2 });
    try {
      const found = await verifyDevClient.db
        .select()
        .from(platformEnvMetadata)
        .where(eq(platformEnvMetadata.key, devMarkerKey));
      expect(found).toHaveLength(1);
      expect(found[0]?.value).toEqual({ preserved: true });

      await verifyDevClient.db
        .delete(platformEnvMetadata)
        .where(eq(platformEnvMetadata.key, devMarkerKey));
    } finally {
      await verifyDevClient.close();
    }
  });
});
