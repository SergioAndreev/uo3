import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = resolve(import.meta.dirname, "..");

interface ViteBuildOutput {
  readonly output?: readonly { readonly type: string; readonly code?: string }[];
}

interface ViteModule {
  readonly build: (config: Record<string, unknown>) => Promise<ViteBuildOutput | ViteBuildOutput[]>;
}

async function loadVite(): Promise<ViteModule> {
  const clientRequire = createRequire(resolve(ROOT_DIR, "apps/client/package.json"));
  const viteEntry = clientRequire.resolve("vite");
  return (await import(`file:///${viteEntry.replace(/\\/g, "/")}`)) as ViteModule;
}

describe("Isomorphic browser ESM bundling (@uo3/domain & @uo3/rules)", () => {
  it("bundles @uo3/domain and @uo3/rules for browser ESM without Node polyfills or node:* warnings", async () => {
    const { build } = await loadVite();

    for (const [pkgName, entryRel] of [
      ["@uo3/domain", "packages/domain/src/index.ts"],
      ["@uo3/rules", "packages/rules/src/index.ts"],
    ] as const) {
      const warnings: string[] = [];
      const result = await build({
        configFile: false,
        logLevel: "silent",
        build: {
          write: false,
          target: "es2022",
          lib: {
            entry: resolve(ROOT_DIR, entryRel),
            formats: ["es"],
            fileName: () => "bundle.mjs",
          },
          rollupOptions: {
            onwarn(warning: { message?: string }) {
              if (warning.message) {
                warnings.push(warning.message);
              }
            },
          },
        },
      });

      const bundles = Array.isArray(result) ? result : [result];
      const chunks = bundles.flatMap((b) => (b.output ?? []).filter((o) => o.type === "chunk"));
      expect(chunks.length, `${pkgName} should emit at least one ESM chunk`).toBeGreaterThan(0);

      const combinedCode = chunks.map((c) => c.code ?? "").join("\n");
      expect(
        warnings.filter((w) => /node:|polyfill|externalized for browser/i.test(w)),
        `${pkgName} browser build warnings: ${warnings.join("; ")}`,
      ).toEqual([]);
      expect(combinedCode).not.toMatch(/["']node:[a-z0-9_/-]+["']/);
    }
  }, 25_000);
});
