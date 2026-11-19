import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checkPortConflicts, copyMissingEnvFiles, runBootstrap } from "./bootstrap.js";

describe("bootstrap script unit tests", () => {
  it("creates missing .env from .env.example and never overwrites customized existing .env", () => {
    const dir = mkdtempSync(join(tmpdir(), "uo3-bootstrap-env-"));
    try {
      mkdirSync(join(dir, "apps/api"), { recursive: true });
      writeFileSync(join(dir, ".env.example"), "PG_PORT=5432\n", "utf8");
      writeFileSync(join(dir, "apps/api/.env.example"), "API_PORT=3001\n", "utf8");
      writeFileSync(join(dir, ".env"), "PG_PORT=15432\n# custom user setting\n", "utf8");

      const report = copyMissingEnvFiles(dir, [".", "apps/api"]);
      expect(report.preserved).toEqual([".env"]);
      expect(report.created).toEqual(["apps/api/.env"]);

      expect(readFileSync(join(dir, ".env"), "utf8")).toContain("PG_PORT=15432");
      expect(readFileSync(join(dir, "apps/api/.env"), "utf8")).toContain("API_PORT=3001");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails fast within <= 10s with actionable message when Docker daemon is unavailable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "uo3-bootstrap-nodocker-"));
    try {
      const errors: string[] = [];
      const started = Date.now();
      const code = await runBootstrap({
        rootDir: dir,
        env: {},
        checkNode: () => ({ ok: true, message: "Node v22.12.0 OK" }),
        checkDocker: () => ({ ok: false, message: "Docker daemon недоступен. Запустите Docker." }),
        errLog: (m) => errors.push(m),
        log: () => undefined,
      });
      const elapsed = Date.now() - started;

      expect(code).not.toBe(0);
      expect(elapsed).toBeLessThanOrEqual(10_000);
      expect(errors.join("\n")).toContain("Docker");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports port conflict on 5432 with explicit PG_PORT override suggestion", async () => {
    const server = createServer();
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", () => res()));
    const addr = server.address();
    const busyPort = typeof addr === "object" && addr ? addr.port : 5432;

    try {
      const conflicts = await checkPortConflicts(
        {
          PG_PORT: String(busyPort),
          VALKEY_PORT: "65001",
          NATS_PORT: "65002",
          NATS_MONITOR_PORT: "65003",
        },
        new Set(),
      );
      expect(conflicts.length).toBeGreaterThanOrEqual(1);
      expect(conflicts[0]).toContain(String(busyPort));
      expect(conflicts[0]).toContain("PG_PORT");
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  });

  it("runs all bootstrap steps idempotently when prerequisites and services are healthy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "uo3-bootstrap-ok-"));
    try {
      writeFileSync(join(dir, ".env.example"), "PG_PORT=5432\n", "utf8");
      const runCommand = vi.fn().mockReturnValue(0);
      const code = await runBootstrap({
        rootDir: dir,
        env: {},
        checkNode: () => ({ ok: true, message: "Node OK" }),
        checkDocker: () => ({ ok: true, message: "Docker OK" }),
        getRunningServices: () => new Set(["postgres", "valkey", "nats"]),
        checkPorts: async () => [],
        runCommand,
        log: () => undefined,
        errLog: () => undefined,
      });
      expect(code).toBe(0);
      expect(runCommand).toHaveBeenCalledTimes(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
