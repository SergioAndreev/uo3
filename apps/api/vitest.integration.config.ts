import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 60_000,
    reporters: ["default", ["junit", { outputFile: "test-results/integration-junit.xml" }]],
  },
});
