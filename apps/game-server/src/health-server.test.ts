import "reflect-metadata";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  formatGameServerStartupConfigLog,
  loadGameServerConfig,
  type GameReadinessProber,
} from "./game-server.module.js";
import { createHealthHttpServer } from "./health-server.js";

const GAME_SERVER_DIR = resolve(import.meta.dirname, "..");

async function withTestServer(
  prober: GameReadinessProber,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createHealthHttpServer("local-dev", prober);
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", () => res()));
  const addr = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
  }
}

describe("@uo3/game-server unit tests", () => {
  it("redacts database password in startup config log", () => {
    const config = loadGameServerConfig({
      loadDotEnv: false,
      env: {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://uo3:g4m3S3cr3t@localhost:5432/uo3_dev",
        VALKEY_URL: "redis://localhost:6379",
        NATS_URL: "nats://localhost:4222",
      },
    });
    const logLine = formatGameServerStartupConfigLog(config);
    expect(logLine).toContain("postgresql://uo3:[REDACTED]@localhost:5432/uo3_dev");
    expect(logLine).not.toContain("g4m3S3cr3t");
  });

  it("returns 200 on /healthz and 200 on /readyz when dependencies are healthy", async () => {
    const prober: GameReadinessProber = {
      checkReadiness: vi.fn().mockResolvedValue({
        ok: true,
        status: "ok",
        shardId: "local-dev",
        dependencies: { postgres: "up", valkey: "up", nats: "up" },
        latencyMs: 8,
      }),
    };

    await withTestServer(prober, async (baseUrl) => {
      const h = await fetch(`${baseUrl}/healthz`);
      expect(h.status).toBe(200);
      expect(((await h.json()) as { status: string }).status).toBe("ok");

      const r = await fetch(`${baseUrl}/readyz`);
      expect(r.status).toBe(200);
      const body = (await r.json()) as {
        status: string;
        dependencies: Record<string, string>;
      };
      expect(body.status).toBe("ok");
      expect(body.dependencies).toEqual({ postgres: "up", valkey: "up", nats: "up" });

      const missing = await fetch(`${baseUrl}/unknown`);
      expect(missing.status).toBe(404);
    });
  });

  it('keeps /healthz at 200 and returns 503 with nats: "down" when NATS fails', async () => {
    const prober: GameReadinessProber = {
      checkReadiness: vi.fn().mockResolvedValue({
        ok: false,
        status: "degraded",
        shardId: "local-dev",
        dependencies: { postgres: "up", valkey: "up", nats: "down" },
        latencyMs: 35,
      }),
    };

    await withTestServer(prober, async (baseUrl) => {
      expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);

      const r = await fetch(`${baseUrl}/readyz`);
      expect(r.status).toBe(503);
      const body = (await r.json()) as {
        status: string;
        dependencies: Record<string, string>;
      };
      expect(body.status).toBe("degraded");
      expect(body.dependencies["nats"]).toBe("down");
    });
  });

  it("exits with code 78 on invalid environment variables", () => {
    const res = spawnSync(process.execPath, ["dist/main.js"], {
      cwd: GAME_SERVER_DIR,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] ?? "",
        NODE_ENV: "production",
        GAME_PORT: "0",
      },
    });
    expect(res.status, res.stderr).toBe(78);
    expect(res.stderr).toContain("DATABASE_URL");
    expect(res.stderr).toContain("GAME_PORT");
  }, 20_000);

  it("reports degraded dependencies and cleans up cleanly via GameInfraService on unreachable ports", async () => {
    const { GameInfraService, GameServerModule } = await import("./game-server.module.js");
    const cfg = loadGameServerConfig({
      loadDotEnv: false,
      env: {
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://uo3:pass@127.0.0.1:19991/uo3_test",
        VALKEY_URL: "redis://127.0.0.1:19992",
        NATS_URL: "nats://127.0.0.1:19993",
      },
    });
    const mod = GameServerModule.forRoot(cfg);
    expect(mod.module).toBe(GameServerModule);

    const infra = new GameInfraService(cfg);
    const report = await infra.checkReadiness(100);
    expect(report.ok).toBe(false);
    expect(report.status).toBe("degraded");
    expect(report.dependencies).toEqual({ postgres: "down", valkey: "down", nats: "down" });
    await infra.onModuleDestroy();
  });
});
