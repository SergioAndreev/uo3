import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatDoctorReport, runDoctor } from "./doctor.js";

const ROOT_DIR = resolve(import.meta.dirname, "..");

describe("doctor diagnostics script", () => {
  it("marks all checks PASS when stack and env are healthy", async () => {
    const res = await runDoctor(
      ROOT_DIR,
      {},
      {
        checkNode: () => ({ ok: true, message: "Node v22.12.0 OK" }),
        checkPnpm: () => ({ name: "pnpm", status: "PASS", details: "pnpm v9.15.9" }),
        checkDocker: () => ({ ok: true, message: "Docker OK" }),
        checkEnv: () => ({ name: "env-files", status: "PASS", details: "All .env valid" }),
        probePostgres: async () => true,
        probeValkey: async () => true,
        probeNats: async () => true,
      },
    );

    expect(res.ok).toBe(true);
    expect(res.results.every((r) => r.status === "PASS")).toBe(true);
    const report = formatDoctorReport(res.results);
    expect(report).toContain("[PASS] valkey:");
    expect(report).not.toContain("[FAIL]");
  });

  it("marks valkey FAIL with host/port and remediation command when Valkey is down", async () => {
    const res = await runDoctor(
      ROOT_DIR,
      { VALKEY_PORT: "6379" },
      {
        checkNode: () => ({ ok: true, message: "Node v22.12.0 OK" }),
        checkPnpm: () => ({ name: "pnpm", status: "PASS", details: "pnpm v9.15.9" }),
        checkDocker: () => ({ ok: true, message: "Docker OK" }),
        checkEnv: () => ({ name: "env-files", status: "PASS", details: "All .env valid" }),
        probePostgres: async () => true,
        probeValkey: async () => false,
        probeNats: async () => true,
      },
    );

    expect(res.ok).toBe(false);
    const valkeyCheck = res.results.find((r) => r.name === "valkey");
    expect(valkeyCheck?.status).toBe("FAIL");
    expect(valkeyCheck?.details).toContain("6379");
    expect(valkeyCheck?.hint).toContain("docker compose");
  });
});
