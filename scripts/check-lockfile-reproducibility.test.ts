import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = resolve(import.meta.dirname, "..");

function runPnpm(args: readonly string[], cwd: string) {
  return spawnSync("pnpm", args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      CI: "true",
    },
  });
}

describe("pnpm lockfile reproducibility", () => {
  it("succeeds with --frozen-lockfile --lockfile-only and keeps pnpm-lock.yaml byte-identical", () => {
    const lockfilePath = join(ROOT_DIR, "pnpm-lock.yaml");
    const before = readFileSync(lockfilePath);

    const res = runPnpm(["install", "--frozen-lockfile", "--lockfile-only"], ROOT_DIR);
    expect(res.status, res.stderr || res.stdout).toBe(0);

    const after = readFileSync(lockfilePath);
    expect(after.equals(before)).toBe(true);
  });

  it("fails with non-zero exit code when package.json diverges from pnpm-lock.yaml", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "uo3-lockfile-test-"));
    try {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify(
          {
            name: "uo3-lockfile-divergence-fixture",
            private: true,
            type: "module",
            dependencies: {
              "is-odd": "^3.0.1",
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      writeFileSync(
        join(tempDir, "pnpm-lock.yaml"),
        [
          "lockfileVersion: '9.0'",
          "",
          "importers:",
          "  .:",
          "    dependencies:",
          "      is-even:",
          "        specifier: ^1.0.0",
          "        version: 1.0.0",
          "",
        ].join("\n"),
        "utf8",
      );

      const res = runPnpm(["install", "--frozen-lockfile", "--offline"], tempDir);
      expect(res.status).not.toBe(0);
      const combined = `${res.stdout}\n${res.stderr}`.toLowerCase();
      expect(combined).toContain("lockfile");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
