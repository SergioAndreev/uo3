import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "unit",
      environment: "node",
      include: [
        "scripts/**/*.test.ts",
        "infra/**/*.test.ts",
        "packages/*/src/**/*.test.ts",
        "apps/*/src/**/*.test.ts",
      ],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/*.integration.test.ts",
        "packages/ui-kit/**",
        "apps/client/**",
        "apps/admin/**",
      ],
    },
  },
  {
    test: {
      name: "unit-browser",
      environment: "jsdom",
      include: [
        "packages/ui-kit/src/**/*.test.{ts,tsx}",
        "apps/client/src/**/*.test.{ts,tsx}",
        "apps/admin/src/**/*.test.{ts,tsx}",
      ],
      exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
    },
  },
  {
    test: {
      name: "integration",
      environment: "node",
      include: [
        "scripts/**/*.integration.test.ts",
        "infra/**/*.integration.test.ts",
        "packages/*/src/**/*.integration.test.ts",
        "apps/*/src/**/*.integration.test.ts",
      ],
      exclude: ["**/node_modules/**", "**/dist/**"],
      testTimeout: 120_000,
    },
  },
]);
