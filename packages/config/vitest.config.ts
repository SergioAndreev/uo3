import { defineConfig } from "vitest/config";
import { createNodeVitestConfig } from "./src/vitest/node.js";

export default defineConfig(createNodeVitestConfig({ layer: "core" }));
