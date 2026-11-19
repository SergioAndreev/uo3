import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = resolve(import.meta.dirname, "..");

interface TurboDryTask {
  readonly taskId: string;
  readonly hash: string;
  readonly cache?: { readonly status?: string };
}

interface TurboDryJson {
  readonly tasks: readonly TurboDryTask[];
}

function runTurbo(args: readonly string[]) {
  return spawnSync("pnpm", ["turbo", ...args], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

describe("Turborepo caching and selective invalidation", () => {
  it("achieves 100% FULL TURBO cache hit within 5 seconds on repeated typecheck + build", () => {
    const warm = runTurbo(["run", "typecheck", "build"]);
    expect(warm.status, warm.stderr || warm.stdout).toBe(0);

    const startMs = Date.now();
    const cached = runTurbo(["run", "typecheck", "build"]);
    const elapsedMs = Date.now() - startMs;

    expect(cached.status, cached.stderr || cached.stdout).toBe(0);
    expect(`${cached.stdout}\n${cached.stderr}`).toContain("FULL TURBO");
    expect(elapsedMs).toBeLessThanOrEqual(5_000);
  }, 60_000);

  it("invalidates @uo3/ui-kit subgraph without invalidating server @uo3/db hash", () => {
    const beforeDry = runTurbo(["run", "typecheck", "--dry=json"]);
    expect(beforeDry.status, beforeDry.stderr).toBe(0);
    const beforeJson = JSON.parse(beforeDry.stdout) as TurboDryJson;
    const beforeHashes = new Map(beforeJson.tasks.map((t) => [t.taskId, t.hash]));

    const probeFile = join(ROOT_DIR, "packages/ui-kit/src/__turbo_invalidation_probe__.ts");
    try {
      writeFileSync(probeFile, "export const TURBO_PROBE = 1;\n", "utf8");
      const afterDry = runTurbo(["run", "typecheck", "--dry=json"]);
      expect(afterDry.status, afterDry.stderr).toBe(0);
      const afterJson = JSON.parse(afterDry.stdout) as TurboDryJson;
      const afterHashes = new Map(afterJson.tasks.map((t) => [t.taskId, t.hash]));

      expect(afterHashes.get("@uo3/ui-kit#typecheck")).not.toBe(
        beforeHashes.get("@uo3/ui-kit#typecheck"),
      );
      expect(afterHashes.get("@uo3/db#typecheck")).toBe(beforeHashes.get("@uo3/db#typecheck"));
      expect(afterHashes.get("@uo3/domain#typecheck")).toBe(
        beforeHashes.get("@uo3/domain#typecheck"),
      );
    } finally {
      rmSync(probeFile, { force: true });
    }
  }, 30_000);
});
