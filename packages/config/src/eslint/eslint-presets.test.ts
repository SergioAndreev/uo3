import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { createBaseConfig } from "./base.js";
import { createBoundariesConfig } from "./boundaries.js";
import { createBrowserConfig } from "./browser.js";
import { createServerConfig } from "./server.js";

function createLinter() {
  return new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      ...createBaseConfig(),
      ...createBrowserConfig(),
      ...createServerConfig(),
      ...createBoundariesConfig(),
    ],
  });
}

describe("ESLint 9 flat config presets", () => {
  it("loads all 4 flat configs without schema errors and passes clean code", async () => {
    const eslint = createLinter();
    const results = await eslint.lintText(
      "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
      { filePath: "packages/domain/src/math.ts" },
    );
    expect(results[0]?.errorCount).toBe(0);
  });

  it("forbids explicit any in TypeScript modules", async () => {
    const eslint = createLinter();
    const results = await eslint.lintText("export const bad: any = 1;\n", {
      filePath: "packages/domain/src/bad-any.ts",
    });
    const ruleIds = results[0]?.messages.map((m) => m.ruleId) ?? [];
    expect(ruleIds).toContain("@typescript-eslint/no-explicit-any");
  });

  it("forbids CommonJS require() and module.exports", async () => {
    const eslint = createLinter();
    const reqRes = await eslint.lintText("const fs = require('node:fs');\nexport { fs };\n", {
      filePath: "packages/config/src/bad-cjs.ts",
    });
    expect(reqRes[0]?.errorCount).toBeGreaterThan(0);

    const modRes = await eslint.lintText("module.exports = { a: 1 };\n", {
      filePath: "packages/config/src/bad-exports.ts",
    });
    expect(modRes[0]?.errorCount).toBeGreaterThan(0);
  });

  it("blocks @uo3/db and node:fs in browser modules", async () => {
    const eslint = createLinter();
    const results = await eslint.lintText(
      "import { readFileSync } from 'node:fs';\nimport '@uo3/db';\nexport const x = readFileSync;\n",
      { filePath: "apps/client/src/bad-import.ts" },
    );
    const ruleIds = results[0]?.messages.map((m) => m.ruleId) ?? [];
    expect(ruleIds).toContain("no-restricted-imports");
  });

  it("blocks @uo3/ui-kit in server modules", async () => {
    const eslint = createLinter();
    const results = await eslint.lintText("import '@uo3/ui-kit';\nexport const x = 1;\n", {
      filePath: "apps/api/src/bad-ui.ts",
    });
    const ruleIds = results[0]?.messages.map((m) => m.ruleId) ?? [];
    expect(ruleIds).toContain("no-restricted-imports");
  });
});
