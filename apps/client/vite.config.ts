import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createBundleStatsPlugin, createSecretLeakGuardPlugin } from "./vite.plugins.js";

export default defineConfig({
  plugins: [react(), createSecretLeakGuardPlugin(), createBundleStatsPlugin("@uo3/client")],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
