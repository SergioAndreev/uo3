import js from "@eslint/js";
import type { Linter } from "eslint";
import tseslint from "typescript-eslint";

export function createBaseConfig(): Linter.Config[] {
  return [
    {
      ignores: [
        "**/dist/**",
        "**/coverage/**",
        "**/node_modules/**",
        "**/.turbo/**",
        "**/test-results/**",
        "**/*.d.ts",
      ],
    },
    js.configs.recommended,
    ...(tseslint.configs.recommended as Linter.Config[]),
    {
      name: "uo3/base-rules",
      files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.mjs"],
      rules: {
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-require-imports": "error",
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { prefer: "type-imports", fixStyle: "separate-type-imports" },
        ],
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "no-restricted-syntax": [
          "error",
          {
            selector: "CallExpression[callee.name='require']",
            message: "CommonJS require() is forbidden; use ESM import instead.",
          },
          {
            selector: "MemberExpression[object.name='module'][property.name='exports']",
            message: "CommonJS module.exports is forbidden; use ESM export instead.",
          },
          {
            selector: "AssignmentExpression[left.object.name='exports']",
            message: "CommonJS exports.* assignment is forbidden; use ESM export instead.",
          },
        ],
      },
    },
  ];
}

export const baseConfig: Linter.Config[] = createBaseConfig();
export default baseConfig;
