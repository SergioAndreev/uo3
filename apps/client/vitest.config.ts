import { defineConfig } from "vitest/config";
import { createBrowserVitestConfig } from "@uo3/config/vitest/browser";

export default defineConfig(
  createBrowserVitestConfig({
    layer: "standard",
    coverageExclude: ["src/main.tsx", "vite.plugins.ts"],
  }),
);
