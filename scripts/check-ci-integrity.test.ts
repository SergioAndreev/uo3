import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateCiIntegrity } from "./check-ci-integrity.js";

const ROOT_DIR = resolve(import.meta.dirname, "..");

function copyCiFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "uo3-ci-integrity-"));
  mkdirSync(join(dir, ".github/workflows"), { recursive: true });
  mkdirSync(join(dir, ".github/actions/setup-workspace"), { recursive: true });
  mkdirSync(join(dir, ".github/rulesets"), { recursive: true });
  copyFileSync(join(ROOT_DIR, ".github/workflows/ci.yml"), join(dir, ".github/workflows/ci.yml"));
  copyFileSync(
    join(ROOT_DIR, ".github/workflows/nightly.yml"),
    join(dir, ".github/workflows/nightly.yml"),
  );
  copyFileSync(
    join(ROOT_DIR, ".github/actions/setup-workspace/action.yml"),
    join(dir, ".github/actions/setup-workspace/action.yml"),
  );
  copyFileSync(
    join(ROOT_DIR, ".github/rulesets/main.json"),
    join(dir, ".github/rulesets/main.json"),
  );
  copyFileSync(join(ROOT_DIR, "docker-compose.yml"), join(dir, "docker-compose.yml"));
  return dir;
}

describe("check-ci-integrity validator", () => {
  it("passes cleanly on the real repository CI configuration", () => {
    expect(validateCiIntegrity(ROOT_DIR)).toEqual([]);
  });

  it("rejects unpinned GitHub Action tag like actions/checkout@v4", () => {
    const dir = copyCiFixture();
    try {
      const ciPath = join(dir, ".github/workflows/ci.yml");
      const modified = readFileSync(ciPath, "utf8").replace(
        /actions\/checkout@[0-9a-f]{40}/,
        "actions/checkout@v4",
      );
      writeFileSync(ciPath, modified, "utf8");

      const violations = validateCiIntegrity(dir);
      expect(violations.some((v) => v.rule === "action-sha-pinning")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects mismatch between ci-required job name and .github/rulesets/main.json", () => {
    const dir = copyCiFixture();
    try {
      const rulesetPath = join(dir, ".github/rulesets/main.json");
      const modified = readFileSync(rulesetPath, "utf8").replace("ci-required", "ci-renamed-gate");
      writeFileSync(rulesetPath, modified, "utf8");

      const violations = validateCiIntegrity(dir);
      expect(violations.some((v) => v.rule === "ruleset-ci-status-match")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects Docker service image version drift between docker-compose.yml and ci.yml", () => {
    const dir = copyCiFixture();
    try {
      const ciPath = join(dir, ".github/workflows/ci.yml");
      const modified = readFileSync(ciPath, "utf8").replace(
        "postgres:17.2-alpine",
        "postgres:16.4-alpine",
      );
      writeFileSync(ciPath, modified, "utf8");

      const violations = validateCiIntegrity(dir);
      expect(violations.some((v) => v.rule === "docker-image-parity")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
