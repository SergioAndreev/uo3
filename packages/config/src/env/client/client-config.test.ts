import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  ConfigErrorCode,
  createSecretSchema,
  HttpUrlSchema,
  WsUrlSchema,
} from "../shared/index.js";
import { assertClientSchemaSafe, loadClientConfig } from "./loader.js";

const ValidClientSchema = Type.Object({
  VITE_APP_ENV: Type.Union([
    Type.Literal("development"),
    Type.Literal("test"),
    Type.Literal("staging"),
    Type.Literal("production"),
  ]),
  VITE_API_BASE_URL: HttpUrlSchema(),
  VITE_GAME_WS_URL: WsUrlSchema(),
  VITE_DEBUG_MODE: Type.Optional(Type.Boolean({ default: false })),
});

describe("Browser client configuration loader (@uo3/config/env/client)", () => {
  it("loads and deeply freezes valid VITE_* variables", () => {
    const cfg = loadClientConfig(ValidClientSchema, {
      VITE_APP_ENV: "development",
      VITE_API_BASE_URL: "http://localhost:3001",
      VITE_GAME_WS_URL: "ws://localhost:2567",
      VITE_DEBUG_MODE: "1",
      DATABASE_URL: "postgresql://should-be-ignored@localhost:5432/uo3_dev",
    });

    expect(cfg).toEqual({
      VITE_APP_ENV: "development",
      VITE_API_BASE_URL: "http://localhost:3001",
      VITE_GAME_WS_URL: "ws://localhost:2567",
      VITE_DEBUG_MODE: true,
    });
    expect("DATABASE_URL" in cfg).toBe(false);
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it("rejects non-VITE keys and x-secret fields with CONFIG_CLIENT_SECRET_FORBIDDEN", () => {
    const BadNoPrefixSchema = Type.Object({
      DATABASE_URL: Type.String(),
    });
    try {
      assertClientSchemaSafe(BadNoPrefixSchema);
      expect.unreachable("Expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const cfgErr = err as ConfigError;
      expect(cfgErr.issues[0]?.code).toBe(ConfigErrorCode.CONFIG_CLIENT_SECRET_FORBIDDEN);
      expect(cfgErr.issues[0]?.key).toBe("DATABASE_URL");
    }

    const BadSecretSchema = Type.Object({
      VITE_JWT_PRIVATE_KEY: createSecretSchema(),
    });
    try {
      loadClientConfig(BadSecretSchema, { VITE_JWT_PRIVATE_KEY: "secret" });
      expect.unreachable("Expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const cfgErr = err as ConfigError;
      expect(cfgErr.issues[0]?.code).toBe(ConfigErrorCode.CONFIG_CLIENT_SECRET_FORBIDDEN);
      expect(cfgErr.issues[0]?.key).toBe("VITE_JWT_PRIVATE_KEY");
    }
  });

  it("rejects invalid client URLs and missing required VITE_* fields", () => {
    try {
      loadClientConfig(ValidClientSchema, {
        VITE_APP_ENV: "development",
        VITE_API_BASE_URL: "ftp://invalid.local",
      });
      expect.unreachable("Expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const cfgErr = err as ConfigError;
      expect(cfgErr.issues.some((i) => i.key === "VITE_API_BASE_URL")).toBe(true);
      expect(cfgErr.issues.some((i) => i.key === "VITE_GAME_WS_URL")).toBe(true);
    }
  });
});
