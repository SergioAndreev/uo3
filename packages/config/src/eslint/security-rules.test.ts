import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { createBaseConfig } from "./base.js";
import { createBrowserConfig } from "./browser.js";

function createBrowserLinter() {
  return new ESLint({
    overrideConfigFile: true,
    overrideConfig: [...createBaseConfig(), ...createBrowserConfig()],
  });
}

describe("Browser security ESLint rules (ADR-012)", () => {
  const targets = [
    "apps/client/src/unsafe.ts",
    "apps/admin/src/unsafe.ts",
    "packages/ui-kit/src/unsafe.tsx",
  ];

  for (const filePath of targets) {
    it(`blocks eval(), new Function(), and string setTimeout() in ${filePath}`, async () => {
      const eslint = createBrowserLinter();

      const evalRes = await eslint.lintText("export const a = eval('1 + 1');\n", { filePath });
      expect(evalRes[0]?.messages.map((m) => m.ruleId)).toContain("no-eval");

      const fnRes = await eslint.lintText("export const f = new Function('return 1');\n", {
        filePath,
      });
      expect(fnRes[0]?.messages.map((m) => m.ruleId)).toContain("no-new-func");

      const timeoutRes = await eslint.lintText("setTimeout('console.log(1)', 10);\n", {
        filePath,
      });
      expect(timeoutRes[0]?.messages.map((m) => m.ruleId)).toContain("no-implied-eval");
    });
  }
});
