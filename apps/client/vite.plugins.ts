import type { Plugin, Rollup } from "vite";
import { scanBundleTextForSecrets } from "./src/secret-guard.js";

export function createSecretLeakGuardPlugin(): Plugin {
  return {
    name: "uo3-secret-leak-guard",
    generateBundle(_options, bundle) {
      for (const [fileName, item] of Object.entries(bundle)) {
        const text =
          item.type === "chunk"
            ? (item as Rollup.OutputChunk).code
            : typeof (item as Rollup.OutputAsset).source === "string"
              ? ((item as Rollup.OutputAsset).source as string)
              : "";
        const violation = scanBundleTextForSecrets(text);
        if (violation !== null) {
          throw new Error(
            `CONFIG_CLIENT_SECRET_FORBIDDEN: Обнаружена потенциальная утечка серверного секрета (${violation}) в клиентском бандле ${fileName}.`,
          );
        }
      }
    },
  };
}

export function createBundleStatsPlugin(appName: string): Plugin {
  return {
    name: "uo3-bundle-stats",
    generateBundle(_options, bundle) {
      const files = Object.entries(bundle).map(([fileName, item]) => {
        const bytes =
          item.type === "chunk"
            ? Buffer.byteLength((item as Rollup.OutputChunk).code, "utf8")
            : Buffer.byteLength((item as Rollup.OutputAsset).source);
        return { fileName, type: item.type, bytes };
      });
      const totalBytes = files.reduce((acc, f) => acc + f.bytes, 0);
      this.emitFile({
        type: "asset",
        fileName: "bundle-stats.json",
        source: JSON.stringify({ appName, totalBytes, files }, null, 2),
      });
    },
  };
}
