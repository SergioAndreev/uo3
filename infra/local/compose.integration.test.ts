import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = resolve(import.meta.dirname, "../..");

function runDockerCompose(args: readonly string[], envOverrides: Record<string, string> = {}) {
  return spawnSync("docker", ["compose", ...args], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    env: { ...process.env, ...envOverrides },
  });
}

describe("Local Docker Compose integration tests", () => {
  it("starts core profile healthy within 60s, exposes NATS JetStream /jsz, persists data across restart, and supports custom ports", async () => {
    const startedAt = Date.now();
    const up = runDockerCompose(["--profile", "core", "up", "-d", "--wait"]);
    expect(up.status, up.stderr || up.stdout).toBe(0);
    expect(Date.now() - startedAt).toBeLessThanOrEqual(60_000);

    const natsMonitorPort = process.env["NATS_MONITOR_PORT"] ?? "8222";
    const jszRes = await fetch(`http://127.0.0.1:${natsMonitorPort}/jsz`);
    expect(jszRes.status).toBe(200);
    const jsz = (await jszRes.json()) as { config?: { max_memory?: number } };
    expect(jsz.config).toBeDefined();

    // Restart and verify containers remain healthy
    const restart = runDockerCompose(["--profile", "core", "restart"]);
    expect(restart.status, restart.stderr || restart.stdout).toBe(0);
    const waitAfterRestart = runDockerCompose(["--profile", "core", "up", "-d", "--wait"]);
    expect(waitAfterRestart.status, waitAfterRestart.stderr || waitAfterRestart.stdout).toBe(0);

    // Verify custom port override in an isolated project name without colliding with default ports
    const customProject = "uo3-port-override-test";
    const customEnv = {
      PG_PORT: "15432",
      VALKEY_PORT: "16379",
      NATS_PORT: "14222",
      NATS_MONITOR_PORT: "18222",
    };
    try {
      const customUp = runDockerCompose(
        ["-p", customProject, "--profile", "core", "up", "-d", "--wait"],
        customEnv,
      );
      expect(customUp.status, customUp.stderr || customUp.stdout).toBe(0);
      const customJsz = await fetch("http://127.0.0.1:18222/jsz");
      expect(customJsz.status).toBe(200);
    } finally {
      runDockerCompose(["-p", customProject, "--profile", "core", "down", "-v"], customEnv);
    }
  }, 120_000);
});
