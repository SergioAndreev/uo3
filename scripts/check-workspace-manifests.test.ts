import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateWorkspaceManifests } from "./check-workspace-manifests.js";

const ROOT_DIR = resolve(import.meta.dirname, "..");

function createFixtureWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "uo3-manifest-test-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "@uo3/root",
      private: true,
      type: "module",
      packageManager: "pnpm@9.15.9",
      engines: { node: ">=22.0.0 <23.0.0" },
      pnpm: { onlyBuiltDependencies: ["esbuild"] },
    }),
    "utf8",
  );
  mkdirSync(join(dir, "packages/domain"), { recursive: true });
  writeFileSync(join(dir, "packages/domain/tsconfig.json"), "{}", "utf8");
  writeFileSync(
    join(dir, "packages/domain/package.json"),
    JSON.stringify({
      name: "@uo3/domain",
      private: true,
      type: "module",
      engines: { node: ">=22.0.0 <23.0.0" },
      dependencies: {},
    }),
    "utf8",
  );
  mkdirSync(join(dir, "packages/rules"), { recursive: true });
  writeFileSync(join(dir, "packages/rules/tsconfig.json"), "{}", "utf8");
  writeFileSync(
    join(dir, "packages/rules/package.json"),
    JSON.stringify({
      name: "@uo3/rules",
      private: true,
      type: "module",
      engines: { node: ">=22.0.0 <23.0.0" },
      dependencies: { "@uo3/domain": "workspace:*" },
      devDependencies: { "@uo3/test-kit": "workspace:*" },
    }),
    "utf8",
  );
  return dir;
}

describe("check-workspace-manifests", () => {
  it("passes cleanly on the real monorepo workspace with all 15 modules", () => {
    const violations = validateWorkspaceManifests(ROOT_DIR, { requireAll15: true });
    expect(violations).toEqual([]);
  });

  it("rejects @uo3/test-kit placed in runtime dependencies", () => {
    const dir = createFixtureWorkspace();
    try {
      writeFileSync(
        join(dir, "packages/rules/package.json"),
        JSON.stringify({
          name: "@uo3/rules",
          private: true,
          type: "module",
          engines: { node: ">=22.0.0 <23.0.0" },
          dependencies: { "@uo3/test-kit": "workspace:*" },
        }),
        "utf8",
      );
      const violations = validateWorkspaceManifests(dir);
      expect(violations.some((v) => v.rule === "test-kit-dev-only")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unauthorized external runtime dependencies in @uo3/domain while allowing @sinclair/typebox", () => {
    const dir = createFixtureWorkspace();
    try {
      writeFileSync(
        join(dir, "packages/domain/package.json"),
        JSON.stringify({
          name: "@uo3/domain",
          private: true,
          type: "module",
          engines: { node: ">=22.0.0 <23.0.0" },
          dependencies: { "@sinclair/typebox": "catalog:" },
        }),
        "utf8",
      );
      expect(validateWorkspaceManifests(dir)).toEqual([]);

      writeFileSync(
        join(dir, "packages/domain/package.json"),
        JSON.stringify({
          name: "@uo3/domain",
          private: true,
          type: "module",
          engines: { node: ">=22.0.0 <23.0.0" },
          dependencies: { lodash: "^4.17.21" },
        }),
        "utf8",
      );
      const violations = validateWorkspaceManifests(dir);
      expect(violations.some((v) => v.rule === "domain-pure-dependencies")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects non-workspace protocol for internal @uo3/* dependencies and missing onlyBuiltDependencies", () => {
    const dir = createFixtureWorkspace();
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "@uo3/root",
          private: true,
          type: "module",
          packageManager: "pnpm@9.15.9",
          engines: { node: ">=22.0.0 <23.0.0" },
        }),
        "utf8",
      );
      writeFileSync(
        join(dir, "packages/rules/package.json"),
        JSON.stringify({
          name: "@uo3/rules",
          private: true,
          type: "module",
          engines: { node: ">=22.0.0 <23.0.0" },
          dependencies: { "@uo3/domain": "^0.0.1" },
        }),
        "utf8",
      );
      const violations = validateWorkspaceManifests(dir);
      expect(violations.some((v) => v.rule === "workspace-protocol")).toBe(true);
      expect(violations.some((v) => v.rule === "pnpm-only-built-dependencies")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
