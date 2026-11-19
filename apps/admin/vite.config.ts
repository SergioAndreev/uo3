import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type Rollup } from "vite";

function createAdminBundlePlugins(): Plugin[] {
  return [
    {
      name: "uo3-admin-secret-guard",
      generateBundle(_options, bundle) {
        for (const [fileName, item] of Object.entries(bundle)) {
          const code = item.type === "chunk" ? (item as Rollup.OutputChunk).code : "";
          if (
            /DATABASE_URL|IDENTITY_JWT_SIGNING_KEYS_JSON|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(
              code,
            )
          ) {
            throw new Error(`CONFIG_CLIENT_SECRET_FORBIDDEN in ${fileName}`);
          }
        }
      },
    },
    {
      name: "uo3-admin-bundle-stats",
      generateBundle(_options, bundle) {
        const files = Object.entries(bundle).map(([fileName, item]) => ({
          fileName,
          type: item.type,
          bytes:
            item.type === "chunk"
              ? Buffer.byteLength((item as Rollup.OutputChunk).code, "utf8")
              : Buffer.byteLength((item as Rollup.OutputAsset).source),
        }));
        const totalBytes = files.reduce((acc, f) => acc + f.bytes, 0);
        this.emitFile({
          type: "asset",
          fileName: "bundle-stats.json",
          source: JSON.stringify({ appName: "@uo3/admin", totalBytes, files }, null, 2),
        });
      },
    },
  ];
}

export default defineConfig({
  plugins: [react(), ...createAdminBundlePlugins()],
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
