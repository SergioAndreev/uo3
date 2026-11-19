import { defineConfig } from "vitest/config";
import { createNodeVitestConfig } from "@uo3/config/vitest/node";

export default defineConfig(
  createNodeVitestConfig({
    layer: "standard",
    coverageExclude: ["src/main.ts"],
  }),
);
