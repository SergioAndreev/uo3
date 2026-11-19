export type CoverageLayer = "core" | "standard";

export interface CoverageThresholds {
  readonly lines: number;
  readonly statements: number;
  readonly branches: number;
  readonly functions: number;
}

export const CORE_PACKAGES = new Set(["@uo3/domain", "@uo3/rules", "@uo3/protocol", "@uo3/config"]);

export const COVERAGE_EXCLUDES: readonly string[] = [
  "**/dist/**",
  "**/*.d.ts",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.integration.test.ts",
  "**/packages/test-kit/**",
  "**/node_modules/**",
  "**/*.config.*",
  "**/vitest.config.*",
  "**/drizzle/**",
];

export function createCoverageThresholds(layer: CoverageLayer): CoverageThresholds {
  if (layer === "core") {
    return {
      lines: 85,
      statements: 85,
      branches: 80,
      functions: 80,
    };
  }
  return {
    lines: 70,
    statements: 70,
    branches: 65,
    functions: 65,
  };
}

export function resolveCoverageLayer(packageName: string): CoverageLayer {
  return CORE_PACKAGES.has(packageName) ? "core" : "standard";
}
