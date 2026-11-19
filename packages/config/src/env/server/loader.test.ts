import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { NodeEnvSchema, PostgresUrlSchema, TcpPortSchema } from "../shared/index.js";
import { loadServerConfig, loadServerConfigOrExit } from "./loader.js";

const CONFIG_PKG_DIR = resolve(import.meta.dirname, "../../..");

const DemoSchema = Type.Object({
  NODE_ENV: NodeEnvSchema("development"),
  API_PORT: TcpPortSchema(3001),
  DATABASE_URL: PostgresUrlSchema(),
  ENABLE_SWAGGER: Type.Boolean({ default: false }),
});

describe("loadServerConfig and fail-fast exit 78", () => {
  it("coerces strings to numbers/booleans and returns deeply frozen config", () => {
    const cfg = loadServerConfig(DemoSchema, {
      loadDotEnv: false,
      env: {
        NODE_ENV: "development",
        API_PORT: "3001",
        DATABASE_URL: "postgresql://uo3:pass@localhost:5432/uo3_dev",
        ENABLE_SWAGGER: "true",
      },
    });
    expect(cfg.API_PORT).toBe(3001);
    expect(cfg.ENABLE_SWAGGER).toBe(true);
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it("exits child Node process with code 78 and reports all invalid fields in one pass", () => {
    const script = [
      'import { Type } from "@sinclair/typebox";',
      'import { loadServerConfigOrExit } from "./dist/env/server/index.js";',
      'import { NodeEnvSchema, PostgresUrlSchema, TcpPortSchema } from "./dist/env/shared/index.js";',
      "const Schema = Type.Object({",
      "  NODE_ENV: NodeEnvSchema('development'),",
      "  API_PORT: TcpPortSchema(3001),",
      "  DATABASE_URL: PostgresUrlSchema(),",
      "});",
      "loadServerConfigOrExit(Schema, { loadDotEnv: false, appName: 'api-test', env: { NODE_ENV: 'development', API_PORT: '99999' } });",
    ].join("\n");

    const res = spawnSync(process.execPath, ["--input-type=module"], {
      cwd: CONFIG_PKG_DIR,
      input: script,
      encoding: "utf8",
    });

    expect(res.status, res.stderr).toBe(78);
    expect(res.stderr).toContain("DATABASE_URL");
    expect(res.stderr).toContain("API_PORT");
  });

  it("calls custom onExit callback with 78 in loadServerConfigOrExit", () => {
    let capturedCode: number | undefined;
    expect(() =>
      loadServerConfigOrExit(
        DemoSchema,
        {
          loadDotEnv: false,
          env: { NODE_ENV: "development", ENABLE_SWAGGER: "yes" },
        },
        (code): never => {
          capturedCode = code;
          throw new Error(`EXIT_${code}`);
        },
      ),
    ).toThrow("EXIT_78");
    expect(capturedCode).toBe(78);
  });
});
