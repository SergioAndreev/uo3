import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  ConfigErrorCode,
  createSecretSchema,
  NodeEnvSchema,
} from "../shared/index.js";
import { loadServerConfig } from "./loader.js";

const GuardedSchema = Type.Object({
  NODE_ENV: NodeEnvSchema("development"),
  APP_SECRET: createSecretSchema(),
  CORS_ALLOWED_ORIGINS: Type.String({ default: "*" }),
  CORS_ALLOW_CREDENTIALS: Type.Boolean({ default: false }),
});

describe("Production configuration guards", () => {
  it("allows dev placeholders in development and test modes", () => {
    const devCfg = loadServerConfig(GuardedSchema, {
      loadDotEnv: false,
      env: {
        NODE_ENV: "development",
        APP_SECRET: "CHANGE_ME_LOCAL_DEV_ONLY",
        CORS_ALLOWED_ORIGINS: "*",
        CORS_ALLOW_CREDENTIALS: "true",
      },
    });
    expect(devCfg.APP_SECRET).toBe("CHANGE_ME_LOCAL_DEV_ONLY");

    const testCfg = loadServerConfig(GuardedSchema, {
      loadDotEnv: false,
      env: {
        NODE_ENV: "test",
        APP_SECRET: "dev-secret",
      },
    });
    expect(testCfg.APP_SECRET).toBe("dev-secret");
  });

  it("blocks CHANGE_ME_ placeholder in production with CONFIG_INSECURE_PROD_VALUE", () => {
    try {
      loadServerConfig(GuardedSchema, {
        loadDotEnv: false,
        env: {
          NODE_ENV: "production",
          APP_SECRET: "CHANGE_ME_LOCAL_DEV_ONLY_01234567890123456789",
          CORS_ALLOWED_ORIGINS: "https://play.uo3.example",
          CORS_ALLOW_CREDENTIALS: "true",
        },
      });
      expect.unreachable("Expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const cfgErr = err as ConfigError;
      expect(cfgErr.exitCode).toBe(78);
      expect(cfgErr.issues[0]?.code).toBe(ConfigErrorCode.CONFIG_INSECURE_PROD_VALUE);
      expect(cfgErr.formatReport()).not.toContain("CHANGE_ME_LOCAL_DEV_ONLY_01234567890123456789");
    }
  });

  it("blocks secrets shorter than 32 bytes in production without leaking the secret value", () => {
    const shortSecret = "abc123short";
    try {
      loadServerConfig(GuardedSchema, {
        loadDotEnv: false,
        env: {
          NODE_ENV: "production",
          APP_SECRET: shortSecret,
          CORS_ALLOWED_ORIGINS: "https://play.uo3.example",
        },
      });
      expect.unreachable("Expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const cfgErr = err as ConfigError;
      expect(cfgErr.issues.some((i) => i.code === ConfigErrorCode.CONFIG_INSECURE_PROD_VALUE)).toBe(
        true,
      );
      expect(cfgErr.formatReport()).toContain("32");
      expect(cfgErr.formatReport()).not.toContain(shortSecret);
    }
  });

  it("blocks CORS wildcard * when credentials are enabled in production", () => {
    try {
      loadServerConfig(GuardedSchema, {
        loadDotEnv: false,
        env: {
          NODE_ENV: "production",
          APP_SECRET: "0123456789abcdef0123456789abcdef_strong_key",
          CORS_ALLOWED_ORIGINS: "*",
          CORS_ALLOW_CREDENTIALS: "true",
        },
      });
      expect.unreachable("Expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const cfgErr = err as ConfigError;
      expect(
        cfgErr.issues.some(
          (i) =>
            i.key === "CORS_ALLOWED_ORIGINS" &&
            i.code === ConfigErrorCode.CONFIG_INSECURE_PROD_VALUE,
        ),
      ).toBe(true);
    }
  });

  it("accepts strong production configuration", () => {
    const cfg = loadServerConfig(GuardedSchema, {
      loadDotEnv: false,
      env: {
        NODE_ENV: "production",
        APP_SECRET: "0123456789abcdef0123456789abcdef_strong_key",
        CORS_ALLOWED_ORIGINS: "https://play.uo3.example",
        CORS_ALLOW_CREDENTIALS: "true",
      },
    });
    expect(cfg.NODE_ENV).toBe("production");
    expect(Object.isFrozen(cfg)).toBe(true);
  });
});
