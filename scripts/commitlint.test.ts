import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = resolve(import.meta.dirname, "..");

function lintCommitMessage(message: string) {
  return spawnSync("pnpm", ["exec", "commitlint"], {
    cwd: ROOT_DIR,
    input: `${message}\n`,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

describe("Conventional Commits (commitlint.config.mjs)", () => {
  it("accepts valid scoped commits", () => {
    expect(lintCommitMessage("feat(config): add typed server env validation").status).toBe(0);
    expect(lintCommitMessage("docs(p00): update bootstrap instructions").status).toBe(0);
  }, 20_000);

  it("rejects unstructured messages and headers longer than 100 chars", () => {
    expect(lintCommitMessage("fix bug").status).not.toBe(0);

    const longHeader = `feat(config): ${"a".repeat(100)}`;
    expect(longHeader.length).toBeGreaterThan(100);
    expect(lintCommitMessage(longHeader).status).not.toBe(0);
  }, 20_000);

  it("allows standard Revert commits and Changesets release commits", () => {
    expect(lintCommitMessage('Revert "feat(config): add typed server env validation"').status).toBe(
      0,
    );
    expect(lintCommitMessage("chore(release): version packages").status).toBe(0);
  }, 20_000);
});
