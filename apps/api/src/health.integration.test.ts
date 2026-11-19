import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { AppModule } from "./app.module.js";
import { loadApiConfig } from "./config.module.js";

describe("@uo3/api health integration tests", () => {
  it("responds 200 on /healthz and /readyz within 500ms against live PG, Valkey, and NATS, and 503 when NATS is unreachable", async () => {
    const healthyConfig = loadApiConfig({
      loadDotEnv: false,
      env: {
        NODE_ENV: "test",
        LOG_LEVEL: "error",
        API_HOST: "127.0.0.1",
        API_PORT: "3001",
        DATABASE_URL:
          process.env["TEST_DATABASE_URL"] ??
          "postgresql://uo3:CHANGE_ME_LOCAL_DEV_ONLY@127.0.0.1:5432/uo3_test",
        VALKEY_URL: process.env["VALKEY_URL"] ?? "redis://127.0.0.1:6379",
        NATS_URL: process.env["NATS_URL"] ?? "nats://127.0.0.1:4222",
      },
    });

    const app = await NestFactory.create(AppModule.forRoot(healthyConfig), { logger: false });
    await app.listen(0, "127.0.0.1");
    const baseUrl = await app.getUrl();

    try {
      const healthRes = await fetch(`${baseUrl}/healthz`);
      expect(healthRes.status).toBe(200);

      const startedAt = Date.now();
      const readyRes = await fetch(`${baseUrl}/readyz`);
      const elapsedMs = Date.now() - startedAt;
      const body = (await readyRes.json()) as {
        status: string;
        dependencies: Record<string, string>;
      };

      expect(readyRes.status, JSON.stringify(body)).toBe(200);
      expect(elapsedMs).toBeLessThanOrEqual(500);
      expect(body.status).toBe("ok");
      expect(body.dependencies).toEqual({ postgres: "up", valkey: "up", nats: "up" });
    } finally {
      await app.close();
    }

    // Degraded test: point NATS to closed port and verify /healthz=200 & /readyz=503 with nats="down"
    const degradedConfig = loadApiConfig({
      loadDotEnv: false,
      env: {
        NODE_ENV: "test",
        LOG_LEVEL: "error",
        API_HOST: "127.0.0.1",
        API_PORT: "3001",
        DATABASE_URL:
          process.env["TEST_DATABASE_URL"] ??
          "postgresql://uo3:CHANGE_ME_LOCAL_DEV_ONLY@127.0.0.1:5432/uo3_test",
        VALKEY_URL: process.env["VALKEY_URL"] ?? "redis://127.0.0.1:6379",
        NATS_URL: "nats://127.0.0.1:19999",
      },
    });

    const degradedApp = await NestFactory.create(AppModule.forRoot(degradedConfig), {
      logger: false,
    });
    await degradedApp.listen(0, "127.0.0.1");
    const degradedUrl = await degradedApp.getUrl();

    try {
      expect((await fetch(`${degradedUrl}/healthz`)).status).toBe(200);
      const readyRes = await fetch(`${degradedUrl}/readyz`);
      const body = (await readyRes.json()) as {
        status: string;
        dependencies: Record<string, string>;
      };
      expect(readyRes.status).toBe(503);
      expect(body.dependencies["nats"]).toBe("down");
    } finally {
      await degradedApp.close();
    }
  });
});
