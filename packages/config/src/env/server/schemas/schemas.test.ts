import { describe, expect, it } from "vitest";
import { ConfigError, ConfigErrorCode } from "../../shared/index.js";
import { loadServerConfig } from "../loader.js";
import {
  ApiEnvSchema,
  AssetToolEnvSchema,
  BotClientEnvSchema,
  DbEnvSchema,
  GameServerEnvSchema,
  RootInfraEnvSchema,
} from "./index.js";

describe("Server application env schemas", () => {
  it("validates ApiEnvSchema reference config and rejects invalid port/boolean/prod placeholder", () => {
    const valid = loadServerConfig(ApiEnvSchema, {
      loadDotEnv: false,
      env: {
        NODE_ENV: "development",
        LOG_LEVEL: "info",
        API_HOST: "0.0.0.0",
        API_PORT: "3001",
        DATABASE_URL: "postgresql://uo3:CHANGE_ME_LOCAL_DEV_ONLY@localhost:5432/uo3_dev",
        VALKEY_URL: "redis://localhost:6379",
        NATS_URL: "nats://localhost:4222",
        IDENTITY_JWT_SIGNING_KEYS_JSON: "CHANGE_ME_LOCAL_DEV_ONLY",
        CORS_ALLOWED_ORIGINS: "http://localhost:5173",
        CORS_ALLOW_CREDENTIALS: "true",
        ENABLE_SWAGGER: "1",
        SHUTDOWN_TIMEOUT_MS: "15000",
      },
    });
    expect(valid.API_PORT).toBe(3001);
    expect(valid.ENABLE_SWAGGER).toBe(true);

    expect(() =>
      loadServerConfig(ApiEnvSchema, {
        loadDotEnv: false,
        env: {
          NODE_ENV: "development",
          API_PORT: "70000",
          DATABASE_URL: "postgresql://uo3:pass@localhost:5432/uo3_dev",
          VALKEY_URL: "redis://localhost:6379",
          NATS_URL: "ftp://localhost:4222",
          ENABLE_SWAGGER: "yes",
        },
      }),
    ).toThrowError(ConfigError);

    try {
      loadServerConfig(ApiEnvSchema, {
        loadDotEnv: false,
        env: {
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://uo3:test-pass-fixture@localhost:5432/uo3",
          VALKEY_URL: "redis://localhost:6379",
          NATS_URL: "nats://localhost:4222",
          IDENTITY_JWT_SIGNING_KEYS_JSON: "CHANGE_ME_LOCAL_DEV_ONLY",
          CORS_ALLOWED_ORIGINS: "*",
          CORS_ALLOW_CREDENTIALS: "true",
        },
      });
      expect.unreachable("Expected production guard failure");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const cfgErr = err as ConfigError;
      expect(cfgErr.issues.some((i) => i.code === ConfigErrorCode.CONFIG_INSECURE_PROD_VALUE)).toBe(
        true,
      );
    }
  });

  it("validates GameServerEnvSchema, DbEnvSchema, AssetToolEnvSchema, BotClientEnvSchema, and RootInfraEnvSchema", () => {
    const gs = loadServerConfig(GameServerEnvSchema, {
      loadDotEnv: false,
      env: {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://uo3:pass@localhost:5432/uo3_dev",
        VALKEY_URL: "redis://localhost:6379",
        NATS_URL: "nats://localhost:4222",
      },
    });
    expect(gs.GAME_PORT).toBe(2567);
    expect(gs.GAME_HEALTH_PORT).toBe(2568);
    expect(gs.SHARD_ID).toBe("local-dev");

    const db = loadServerConfig(DbEnvSchema, {
      loadDotEnv: false,
      env: {
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://uo3:pass@localhost:5432/uo3_test",
      },
    });
    expect(db.DB_POOL_MAX).toBe(10);

    const tool = loadServerConfig(AssetToolEnvSchema, {
      loadDotEnv: false,
      env: { NODE_ENV: "development" },
    });
    expect(tool.SYNTHETIC_OUTPUT_DIR).toBe("./local-assets/synthetic");

    const bot = loadServerConfig(BotClientEnvSchema, {
      loadDotEnv: false,
      env: {
        NODE_ENV: "development",
        TARGET_API_URL: "http://localhost:3001",
        TARGET_GAME_WS_URL: "ws://localhost:2567",
        BOT_CONCURRENCY: "250",
      },
    });
    expect(bot.BOT_CONCURRENCY).toBe(250);

    expect(() =>
      loadServerConfig(BotClientEnvSchema, {
        loadDotEnv: false,
        env: {
          NODE_ENV: "development",
          TARGET_API_URL: "http://localhost:3001",
          TARGET_GAME_WS_URL: "http://not-ws:2567",
          BOT_CONCURRENCY: "9999",
        },
      }),
    ).toThrowError(ConfigError);

    const infra = loadServerConfig(RootInfraEnvSchema, {
      loadDotEnv: false,
      env: {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://uo3:pass@localhost:5432/uo3_dev",
        TEST_DATABASE_URL: "postgresql://uo3:pass@localhost:5432/uo3_test",
        VALKEY_URL: "redis://localhost:6379",
        NATS_URL: "nats://localhost:4222",
      },
    });
    expect(infra.PG_PORT).toBe(5432);
    expect(infra.GRAFANA_PORT).toBe(3000);
  });
});
