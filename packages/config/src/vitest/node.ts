import type { ViteUserConfig } from "vitest/config";
import { COVERAGE_EXCLUDES, createCoverageThresholds, type CoverageLayer } from "./thresholds.js";

export interface NodeVitestPresetOptions {
  readonly layer?: CoverageLayer;
  readonly include?: string[];
  readonly exclude?: string[];
  readonly coverageExclude?: string[];
  readonly junitOutputFile?: string;
  readonly jsonOutputFile?: string;
}

export function createNodeVitestConfig(options: NodeVitestPresetOptions = {}): ViteUserConfig {
  const layer = options.layer ?? "standard";
  const thresholds = createCoverageThresholds(layer);

  return {
    test: {
      environment: "node",
      include: options.include ?? ["src/**/*.test.ts"],
      exclude: options.exclude ?? ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
      reporters: [
        "default",
        ["junit", { outputFile: options.junitOutputFile ?? "test-results/junit.xml" }],
        ["json", { outputFile: options.jsonOutputFile ?? "test-results/results.json" }],
      ],
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov", "json-summary"],
        reportsDirectory: "coverage",
        exclude: [...COVERAGE_EXCLUDES, ...(options.coverageExclude ?? [])],
        thresholds: {
          lines: thresholds.lines,
          statements: thresholds.statements,
          branches: thresholds.branches,
          functions: thresholds.functions,
        },
      },
    },
  };
}

export { COVERAGE_EXCLUDES, createCoverageThresholds, resolveCoverageLayer } from "./thresholds.js";
export type { CoverageLayer, CoverageThresholds } from "./thresholds.js";
export default createNodeVitestConfig;
