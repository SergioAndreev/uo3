import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  ConfigErrorCode,
  createSecretSchema,
  NodeEnvSchema,
  PostgresUrlSchema,
} from "../shared/index.js";
import { loadServerConfig } from "./loader.js";

const SecretSchema = Type.Object({
  NODE_ENV: NodeEnvSchema("development"),
  DATABASE_URL: PostgresUrlSchema(),
  IDENTITY_JWT_SIGNING_KEYS_JSON: Type.Optional(createSecretSchema()),
});

describe("Secret files (*_FILE) resolution and conflict detection", () => {
  it("reads secret from *_FILE and strips trailing CRLF/LF", () => {
    const dir = mkdtempSync(join(tmpdir(), "uo3-secret-file-"));
    try {
      const keyFile = join(dir, "jwt.key");
      writeFileSync(keyFile, '{"kty":"OKP","crv":"Ed25519","d":"secret-val"}\r\n', "utf8");

      const cfg = loadServerConfig(SecretSchema, {
        loadDotEnv: false,
        env: {
          NODE_ENV: "development",
          DATABASE_URL: "postgresql://uo3:pass@localhost:5432/uo3_dev",
          IDENTITY_JWT_SIGNING_KEYS_JSON_FILE: keyFile,
        },
      });

      expect(cfg.IDENTITY_JWT_SIGNING_KEYS_JSON).toBe(
        '{"kty":"OKP","crv":"Ed25519","d":"secret-val"}',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects simultaneous KEY and KEY_FILE with CONFIG_CONFLICT and exitCode 78", () => {
    const dir = mkdtempSync(join(tmpdir(), "uo3-secret-conflict-"));
    try {
      const dbFile = join(dir, "db.url");
      writeFileSync(dbFile, "postgresql://uo3:pass@localhost:5432/uo3_dev\n", "utf8");

      try {
        loadServerConfig(SecretSchema, {
          loadDotEnv: false,
          env: {
            NODE_ENV: "development",
            DATABASE_URL: "postgresql://uo3:pass@localhost:5432/uo3_dev",
            DATABASE_URL_FILE: dbFile,
          },
        });
        expect.unreachable("Expected ConfigError");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        const cfgErr = err as ConfigError;
        expect(cfgErr.exitCode).toBe(78);
        expect(cfgErr.issues[0]?.code).toBe(ConfigErrorCode.CONFIG_CONFLICT);
        expect(cfgErr.issues[0]?.key).toBe("DATABASE_URL");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects missing secret file with CONFIG_SECRET_FILE_ERROR", () => {
    try {
      loadServerConfig(SecretSchema, {
        loadDotEnv: false,
        env: {
          NODE_ENV: "development",
          DATABASE_URL_FILE: join(tmpdir(), "nonexistent-uo3-secret-file-12345.txt"),
        },
      });
      expect.unreachable("Expected ConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const cfgErr = err as ConfigError;
      expect(cfgErr.exitCode).toBe(78);
      expect(cfgErr.issues.some((i) => i.code === ConfigErrorCode.CONFIG_SECRET_FILE_ERROR)).toBe(
        true,
      );
    }
  });

  it("rejects empty/whitespace-only secret file with CONFIG_SECRET_FILE_ERROR", () => {
    const dir = mkdtempSync(join(tmpdir(), "uo3-secret-empty-"));
    try {
      const emptyFile = join(dir, "empty.secret");
      writeFileSync(emptyFile, "   \r\n\n", "utf8");

      try {
        loadServerConfig(SecretSchema, {
          loadDotEnv: false,
          env: {
            NODE_ENV: "development",
            DATABASE_URL_FILE: emptyFile,
          },
        });
        expect.unreachable("Expected ConfigError");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        const cfgErr = err as ConfigError;
        expect(cfgErr.exitCode).toBe(78);
        expect(cfgErr.issues.some((i) => i.code === ConfigErrorCode.CONFIG_SECRET_FILE_ERROR)).toBe(
          true,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
