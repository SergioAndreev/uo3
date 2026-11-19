import "reflect-metadata";
import type { AddressInfo } from "node:net";
import { NestFactory } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { GameInfraService, GameServerModule, loadGameServerConfig } from "./game-server.module.js";
import { createHealthHttpServer } from "./health-server.js";

describe("@uo3/game-server health integration tests", () => {
  it("responds 200 on /healthz and /readyz within 500ms against live PG/Valkey/NATS, and 503 when NATS is unreachable", async () => {
    const healthyConfig = loadGameServerConfig({
      loadDotEnv: false,
      env: {
        NODE_ENV: "test",
        LOG_LEVEL: "error",
        DATABASE_URL:
          process.env["TEST_DATABASE_URL"] ??
          "postgresql://uo3:CHANGE_ME_LOCAL_DEV_ONLY@127.0.0.1:5432/uo3_test",
        VALKEY_URL: process.env["VALKEY_URL"] ?? "redis://127.0.0.1:6379",
        NATS_URL: process.env["NATS_URL"] ?? "nats://127.0.0.1:4222",
      },
    });

    const ctx = await NestFactory.createApplicationContext(
      GameServerModule.forRoot(healthyConfig),
      { logger: false },
    );
    const infra = ctx.get(GameInfraService);
    const server = createHealthHttpServer(healthyConfig.SHARD_ID, infra);
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", () => res()));
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
      const started = Date.now();
      const readyRes = await fetch(`${baseUrl}/readyz`);
      const elapsedMs = Date.now() - started;
      const body = (await readyRes.json()) as {
        status: string;
        dependencies: Record<string, string>;
      };
      expect(readyRes.status, JSON.stringify(body)).toBe(200);
      expect(elapsedMs).toBeLessThanOrEqual(500);
      expect(body.dependencies).toEqual({ postgres: "up", valkey: "up", nats: "up" });
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
      await ctx.close();
    }

    const degradedConfig = loadGameServerConfig({
      loadDotEnv: false,
      env: {
        NODE_ENV: "test",
        LOG_LEVEL: "error",
        DATABASE_URL:
          process.env["TEST_DATABASE_URL"] ??
          "postgresql://uo3:CHANGE_ME_LOCAL_DEV_ONLY@127.0.0.1:5432/uo3_test",
        VALKEY_URL: process.env["VALKEY_URL"] ?? "redis://127.0.0.1:6379",
        NATS_URL: "nats://127.0.0.1:19999",
      },
    });

    const degCtx = await NestFactory.createApplicationContext(
      GameServerModule.forRoot(degradedConfig),
      { logger: false },
    );
    const degInfra = degCtx.get(GameInfraService);
    const degServer = createHealthHttpServer(degradedConfig.SHARD_ID, degInfra);
    await new Promise<void>((res) => degServer.listen(0, "127.0.0.1", () => res()));
    const degAddr = degServer.address() as AddressInfo;
    const degUrl = `http://127.0.0.1:${degAddr.port}`;

    try {
      expect((await fetch(`${degUrl}/healthz`)).status).toBe(200);
      const readyRes = await fetch(`${degUrl}/readyz`);
      const body = (await readyRes.json()) as {
        dependencies: Record<string, string>;
      };
      expect(readyRes.status).toBe(503);
      expect(body.dependencies["nats"]).toBe("down");
    } finally {
      await new Promise<void>((res) => degServer.close(() => res()));
      await degCtx.close();
    }
  });
});
