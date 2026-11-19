import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createBrowserVitestConfig } from "./browser.js";
import {
  COVERAGE_EXCLUDES,
  createCoverageThresholds,
  createNodeVitestConfig,
  resolveCoverageLayer,
} from "./node.js";

const ROOT_DIR = resolve(import.meta.dirname, "../../../..");

describe("Vitest presets & coverage thresholds", () => {
  it("computes core (85/80) and standard (70/65) thresholds accurately", () => {
    expect(createCoverageThresholds("core")).toEqual({
      lines: 85,
      statements: 85,
      branches: 80,
      functions: 80,
    });
    expect(createCoverageThresholds("standard")).toEqual({
      lines: 70,
      statements: 70,
      branches: 65,
      functions: 65,
    });
  });

  it("maps critical core packages to core layer and others to standard", () => {
    expect(resolveCoverageLayer("@uo3/domain")).toBe("core");
    expect(resolveCoverageLayer("@uo3/rules")).toBe("core");
    expect(resolveCoverageLayer("@uo3/protocol")).toBe("core");
    expect(resolveCoverageLayer("@uo3/config")).toBe("core");
    expect(resolveCoverageLayer("@uo3/db")).toBe("standard");
    expect(resolveCoverageLayer("@uo3/api")).toBe("standard");
  });

  it("generates node preset with v8 coverage, excludes and JUnit/JSON/LCOV reporters", () => {
    const cfg = createNodeVitestConfig({ layer: "core" });
    expect(cfg.test?.environment).toBe("node");
    const cov = cfg.test?.coverage;
    expect(cov?.provider).toBe("v8");
    if (cov && cov.provider === "v8") {
      expect(cov.reporter).toEqual(["text", "lcov", "json-summary"]);
      expect(cov.exclude).toEqual(expect.arrayContaining([...COVERAGE_EXCLUDES]));
      expect(cov.thresholds).toEqual({
        lines: 85,
        statements: 85,
        branches: 80,
        functions: 80,
      });
    }
  });

  it("generates browser preset with jsdom environment and standard thresholds by default", () => {
    const cfg = createBrowserVitestConfig();
    expect(cfg.test?.environment).toBe("jsdom");
    const cov = cfg.test?.coverage;
    expect(cov?.provider).toBe("v8");
    expect(cov && "thresholds" in cov ? cov.thresholds : undefined).toEqual({
      lines: 70,
      statements: 70,
      branches: 65,
      functions: 65,
    });
  });

  it("fails with non-zero exit code when coverage drops below configured threshold", () => {
    const dir = mkdtempSync(join(ROOT_DIR, ".tmp-cov-fail-"));
    try {
      writeFileSync(
        join(dir, "sample.ts"),
        [
          "export function classify(x: number): string {",
          "  if (x > 100) return 'huge';",
          "  if (x > 50) return 'big';",
          "  if (x > 10) return 'medium';",
          "  if (x > 0) return 'small';",
          "  return 'non-positive';",
          "}",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(
        join(dir, "sample.test.ts"),
        [
          "import { describe, expect, it } from 'vitest';",
          "import { classify } from './sample.js';",
          "describe('sample', () => {",
          "  it('only covers one branch', () => {",
          "    expect(classify(200)).toBe('huge');",
          "  });",
          "});",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(
        join(dir, "vitest.config.ts"),
        [
          "export default {",
          `  root: ${JSON.stringify(dir)},`,
          "  test: {",
          "    environment: 'node',",
          "    include: ['sample.test.ts'],",
          "    coverage: {",
          "      provider: 'v8',",
          "      include: ['sample.ts'],",
          "      thresholds: { lines: 85, statements: 85, branches: 80, functions: 80 },",
          "    },",
          "  },",
          "};",
        ].join("\n"),
        "utf8",
      );

      const res = spawnSync(
        "pnpm",
        ["exec", "vitest", "run", "--config", join(dir, "vitest.config.ts"), "--coverage"],
        {
          cwd: ROOT_DIR,
          encoding: "utf8",
          shell: process.platform === "win32",
        },
      );

      expect(res.status).not.toBe(0);
      const output = `${res.stdout}\n${res.stderr}`.toLowerCase();
      expect(output).toContain("coverage");
      expect(output).toContain("branches");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
