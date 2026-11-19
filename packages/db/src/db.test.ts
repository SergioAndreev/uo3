import { DbEnvSchema, loadServerConfig } from "@uo3/config/env/server";
import { ConfigError } from "@uo3/config/env/shared";
import { describe, expect, it, vi } from "vitest";
import { checkDbHealth, createDbClient, type DrizzleDb } from "./client.js";
import { platformEnvMetadata } from "./schema/index.js";
import { buildSeedRows, INITIAL_PLATFORM_SEED_ENTRIES, seedDatabase } from "./seed.js";

describe("@uo3/db unit tests", () => {
  it("validates DbEnvSchema for valid and invalid database URLs", () => {
    const ok = loadServerConfig(DbEnvSchema, {
      loadDotEnv: false,
      env: {
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://uo3:pass@localhost:5432/uo3_test",
      },
    });
    expect(ok.DB_POOL_MAX).toBe(10);
    expect(ok.DB_HEALTH_TIMEOUT_MS).toBe(500);

    expect(() =>
      loadServerConfig(DbEnvSchema, {
        loadDotEnv: false,
        env: {
          NODE_ENV: "test",
          DATABASE_URL: "mysql://localhost:3306/bad",
        },
      }),
    ).toThrowError(ConfigError);
  });

  it("reports healthy when execute resolves within timeout and unhealthy on timeout or error", async () => {
    const fastDb = {
      execute: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
    };
    const healthy = await checkDbHealth(fastDb, 200);
    expect(healthy.ok).toBe(true);
    expect(healthy.error).toBeUndefined();

    const failingDb = {
      execute: vi.fn().mockRejectedValue(new Error("connection refused")),
    };
    const failed = await checkDbHealth(failingDb, 200);
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("connection refused");

    const hangingDb = {
      execute: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    };
    const timedOut = await checkDbHealth(hangingDb, 30);
    expect(timedOut.ok).toBe(false);
    expect(timedOut.error).toContain("timed out");
  });

  it("creates and closes a Drizzle client handle without opening eager network sockets", async () => {
    const handle = createDbClient("postgresql://uo3:pass@localhost:5432/uo3_test", { max: 2 });
    expect(handle.db).toBeDefined();
    expect(handle.pool).toBeDefined();
    await handle.close();
  });

  it("builds deterministic seed rows and executes transactional upsert in seedDatabase", async () => {
    const rows = buildSeedRows();
    expect(rows).toHaveLength(INITIAL_PLATFORM_SEED_ENTRIES.length);
    expect(rows.map((r) => r.key)).toEqual([
      "seed.version",
      "shard.default",
      "world.synthetic_ready",
    ]);
    expect(platformEnvMetadata.key.name).toBe("key");

    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const fakeDb = {
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<void>) => cb({ insert })),
    } as unknown as DrizzleDb;

    const count = await seedDatabase(fakeDb);
    expect(count).toBe(3);
    expect(insert).toHaveBeenCalledTimes(3);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(3);
  });
});
