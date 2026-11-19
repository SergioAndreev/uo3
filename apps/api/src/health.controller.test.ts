import "reflect-metadata";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { formatApiStartupConfigLog, loadApiConfig } from "./config.module.js";
import { HealthController, type HttpResponseLike } from "./health.controller.js";
import type { ReadinessProber } from "./infra.module.js";

const API_DIR = resolve(import.meta.dirname, "..");

function createMockResponse() {
  let statusCode = 0;
  let body: unknown;
  const res: HttpResponseLike = {
    status(code: number) {
      statusCode = code;
      return {
        json(payload: unknown) {
          body = payload;
          return payload;
        },
      };
    },
  };
  return {
    res,
    getStatus: () => statusCode,
    getBody: () => body,
  };
}

describe("@uo3/api unit tests", () => {
  it("redacts database password and JWT signing secret in startup config log", () => {
    const config = loadApiConfig({
      loadDotEnv: false,
      env: {
        NODE_ENV: "development",
        LOG_LEVEL: "info",
        API_HOST: "127.0.0.1",
        API_PORT: "3001",
        DATABASE_URL: "postgresql://uo3:s3cr3tDbPass@localhost:5432/uo3_dev",
        VALKEY_URL: "redis://:v4lk3yPass@localhost:6379",
        NATS_URL: "nats://localhost:4222",
        IDENTITY_JWT_SIGNING_KEYS_JSON: "top-secret-ed25519-key-material",
      },
    });

    const logLine = formatApiStartupConfigLog(config);
    expect(logLine).toContain("postgresql://uo3:[REDACTED]@localhost:5432/uo3_dev");
    expect(logLine).toContain("[REDACTED]");
    expect(logLine).not.toContain("s3cr3tDbPass");
    expect(logLine).not.toContain("v4lk3yPass");
    expect(logLine).not.toContain("top-secret-ed25519-key-material");
  });

  it("returns 200 on /healthz and 200 on /readyz when all dependencies are up", async () => {
    const prober: ReadinessProber = {
      checkReadiness: vi.fn().mockResolvedValue({
        ok: true,
        status: "ok",
        dependencies: { postgres: "up", valkey: "up", nats: "up" },
        latencyMs: 12,
      }),
    };
    const controller = new HealthController(prober);

    expect(controller.getHealthz().status).toBe("ok");

    const mockRes = createMockResponse();
    await controller.getReadyz(mockRes.res);
    expect(mockRes.getStatus()).toBe(200);
    expect(mockRes.getBody()).toEqual({
      status: "ok",
      dependencies: { postgres: "up", valkey: "up", nats: "up" },
      latencyMs: 12,
    });
  });

  it("keeps /healthz at 200 while returning 503 on /readyz when PostgreSQL is down", async () => {
    const prober: ReadinessProber = {
      checkReadiness: vi.fn().mockResolvedValue({
        ok: false,
        status: "degraded",
        dependencies: { postgres: "down", valkey: "up", nats: "up" },
        latencyMs: 40,
      }),
    };
    const controller = new HealthController(prober);

    expect(controller.getHealthz().status).toBe("ok");

    const mockRes = createMockResponse();
    await controller.getReadyz(mockRes.res);
    expect(mockRes.getStatus()).toBe(503);
    expect(mockRes.getBody()).toEqual({
      status: "degraded",
      dependencies: { postgres: "down", valkey: "up", nats: "up" },
      latencyMs: 40,
    });
  });

  it("exits with code 78 when started with invalid environment variables", () => {
    const res = spawnSync(process.execPath, ["dist/main.js"], {
      cwd: API_DIR,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] ?? "",
        NODE_ENV: "production",
        API_PORT: "99999",
      },
    });
    expect(res.status, res.stderr).toBe(78);
    expect(res.stderr).toContain("DATABASE_URL");
    expect(res.stderr).toContain("API_PORT");
  }, 20_000);

  it("reports degraded dependencies and shuts down cleanly via InfraConnectionsService on unreachable ports", async () => {
    const { AppModule } = await import("./app.module.js");
    const { buildReadinessReport, InfraConnectionsService } = await import("./infra.module.js");
    expect(buildReadinessReport(true, true, true, 5)).toEqual({
      ok: true,
      status: "ok",
      dependencies: { postgres: "up", valkey: "up", nats: "up" },
      latencyMs: 5,
    });
    expect(buildReadinessReport(true, false, true, 9).status).toBe("degraded");
    const cfg = loadApiConfig({
      loadDotEnv: false,
      env: {
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://uo3:pass@127.0.0.1:19991/uo3_test",
        VALKEY_URL: "redis://127.0.0.1:19992",
        NATS_URL: "nats://127.0.0.1:19993",
      },
    });
    const mod = AppModule.forRoot(cfg);
    expect(mod.module).toBe(AppModule);

    const infra = new InfraConnectionsService(cfg);
    const report = await infra.checkReadiness(100);
    expect(report.ok).toBe(false);
    expect(report.status).toBe("degraded");
    expect(report.dependencies).toEqual({ postgres: "down", valkey: "down", nats: "down" });
    await infra.onModuleDestroy();
  });
});
