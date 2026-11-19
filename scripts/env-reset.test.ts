import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertLocalDatabaseUrl, runEnvReset } from "./env-reset.js";

describe("env:reset safety guards", () => {
  it("allows strictly local database hosts and blocks remote hosts", () => {
    expect(assertLocalDatabaseUrl("postgresql://uo3:pass@localhost:5432/uo3_dev").ok).toBe(true);
    expect(assertLocalDatabaseUrl("postgresql://uo3:pass@127.0.0.1:5432/uo3_dev").ok).toBe(true);
    expect(assertLocalDatabaseUrl("postgresql://uo3:pass@postgres:5432/uo3_dev").ok).toBe(true);

    const remote = assertLocalDatabaseUrl("postgresql://u:p@prod-db.example.com:5432/uo3");
    expect(remote.ok).toBe(false);
    expect(remote.hostname).toBe("prod-db.example.com");
  });

  it("aborts immediately with non-zero exit code for remote DATABASE_URL without invoking destructive commands", () => {
    const dir = mkdtempSync(join(tmpdir(), "uo3-reset-remote-"));
    try {
      const runCommand = vi.fn().mockReturnValue(0);
      const errors: string[] = [];

      const code = runEnvReset({
        rootDir: dir,
        argv: ["--yes"],
        env: { DATABASE_URL: "postgresql://u:p@prod-db.example.com:5432/uo3" },
        runCommand,
        log: () => undefined,
        errLog: (m) => errors.push(m),
      });

      expect(code).not.toBe(0);
      expect(runCommand).not.toHaveBeenCalled();
      expect(errors.join("\n")).toContain("prod-db.example.com");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to run without --yes confirmation flag", () => {
    const dir = mkdtempSync(join(tmpdir(), "uo3-reset-noyes-"));
    try {
      const runCommand = vi.fn().mockReturnValue(0);
      const errors: string[] = [];

      const code = runEnvReset({
        rootDir: dir,
        argv: [],
        env: { DATABASE_URL: "postgresql://uo3:pass@localhost:5432/uo3_dev" },
        runCommand,
        log: () => undefined,
        errLog: (m) => errors.push(m),
      });

      expect(code).not.toBe(0);
      expect(runCommand).not.toHaveBeenCalled();
      expect(errors.join("\n")).toContain("--yes");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("executes reset pipeline when host is local and --yes is provided", () => {
    const dir = mkdtempSync(join(tmpdir(), "uo3-reset-ok-"));
    try {
      const runCommand = vi.fn().mockReturnValue(0);

      const code = runEnvReset({
        rootDir: dir,
        argv: ["--yes"],
        env: { DATABASE_URL: "postgresql://uo3:pass@localhost:5432/uo3_dev" },
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
