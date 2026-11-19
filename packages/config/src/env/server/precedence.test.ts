import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { ConfigError, LogLevelSchema, NodeEnvSchema, TcpPortSchema } from "../shared/index.js";
import { loadDotEnvFiles, parseDotEnvContent } from "./dotenv.js";
import { loadServerConfig } from "./loader.js";

const SampleSchema = Type.Object({
  NODE_ENV: NodeEnvSchema("development"),
  LOG_LEVEL: LogLevelSchema("info"),
  API_PORT: TcpPortSchema(3001),
  REQUIRED_TOKEN: Type.String({ minLength: 1 }),
});

describe("Server env precedence and .env autoloading", () => {
  it("parses .env comments, quotes, export prefix, and inline comments", () => {
    const parsed = parseDotEnvContent(
      [
        "# comment line",
        "export FOO=bar # inline comment",
        'QUOTED="hello\\nworld"',
        "SINGLE='value with spaces'",
        "INVALID_LINE_WITHOUT_EQ",
      ].join("\n"),
    );
    expect(parsed).toEqual({
      FOO: "bar",
      QUOTED: "hello\nworld",
      SINGLE: "value with spaces",
    });
  });

  it("enforces priority: process.env > .env.<NODE_ENV>.local > .env.local > .env > defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "uo3-env-prec-"));
    try {
      writeFileSync(
        join(dir, ".env"),
        "LOG_LEVEL=warn\nAPI_PORT=4000\nREQUIRED_TOKEN=from-dotenv\n",
        "utf8",
      );
      writeFileSync(join(dir, ".env.local"), "LOG_LEVEL=info\nAPI_PORT=4001\n", "utf8");
      writeFileSync(join(dir, ".env.development.local"), "LOG_LEVEL=trace\n", "utf8");

      const fromFiles = loadServerConfig(SampleSchema, {
        cwd: dir,
        env: { NODE_ENV: "development" },
      });
      expect(fromFiles.LOG_LEVEL).toBe("trace");
      expect(fromFiles.API_PORT).toBe(4001);
      expect(fromFiles.REQUIRED_TOKEN).toBe("from-dotenv");

      const overridden = loadServerConfig(SampleSchema, {
        cwd: dir,
        env: { NODE_ENV: "development", LOG_LEVEL: "debug" },
      });
      expect(overridden.LOG_LEVEL).toBe("debug");
      expect(overridden.API_PORT).toBe(4001);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("disables .env autoload completely in production mode and fails with exitCode 78 if required vars are missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "uo3-env-prod-"));
    try {
      writeFileSync(join(dir, ".env"), "LOG_LEVEL=debug\nREQUIRED_TOKEN=from-dev-file\n", "utf8");
      expect(loadDotEnvFiles("production", dir)).toEqual({});

      expect(() =>
        loadServerConfig(SampleSchema, {
          cwd: dir,
          env: { NODE_ENV: "production" },
        }),
      ).toThrowError(ConfigError);

      try {
        loadServerConfig(SampleSchema, {
          cwd: dir,
          env: { NODE_ENV: "production" },
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        const cfgErr = err as ConfigError;
        expect(cfgErr.exitCode).toBe(78);
        expect(cfgErr.issues.some((i) => i.key === "REQUIRED_TOKEN")).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
