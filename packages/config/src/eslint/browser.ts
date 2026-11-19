import type { Linter } from "eslint";

export const BROWSER_RESTRICTED_IMPORTS = [
  {
    name: "@uo3/db",
    message: "Browser modules must not import server-only @uo3/db.",
  },
  {
    name: "@uo3/config/env/server",
    message: "Browser modules must not import server configuration loader @uo3/config/env/server.",
  },
  {
    name: "@uo3/test-kit",
    message: "Dev-only package @uo3/test-kit must not be imported in production code.",
  },
  {
    name: "colyseus",
    message: "Browser modules must not import server-side colyseus.",
  },
];

export const BROWSER_RESTRICTED_PATTERNS = [
  {
    group: ["node:*", "fs", "fs/*", "path", "net", "http", "https", "child_process", "crypto"],
    message: "Node.js built-in modules are forbidden in browser modules.",
  },
  {
    group: ["@nestjs/*"],
    message: "NestJS server packages are forbidden in browser modules.",
  },
  {
    group: ["@uo3/api", "@uo3/game-server", "@uo3/asset-tool", "@uo3/bot-client"],
    message: "Importing from another application is forbidden.",
  },
];

export function createBrowserConfig(
  files: string[] = [
    "apps/client/src/**/*.{ts,tsx}",
    "apps/admin/src/**/*.{ts,tsx}",
    "packages/ui-kit/src/**/*.{ts,tsx}",
    "packages/config/src/env/client/**/*.ts",
  ],
): Linter.Config[] {
  return [
    {
      name: "uo3/browser-security",
      files,
      languageOptions: {
        globals: {
          window: "readonly",
          document: "readonly",
          self: "readonly",
          globalThis: "readonly",
          setTimeout: "readonly",
          setInterval: "readonly",
          clearTimeout: "readonly",
          clearInterval: "readonly",
          execScript: "readonly",
          console: "readonly",
          fetch: "readonly",
          URL: "readonly",
        },
      },
      rules: {
        "no-eval": "error",
        "no-implied-eval": "error",
        "no-new-func": "error",
      },
    },
    {
      name: "uo3/browser-isolation",
      files,
      ignores: ["**/*.test.ts", "**/*.test.tsx", "**/*.integration.test.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: BROWSER_RESTRICTED_IMPORTS,
            patterns: BROWSER_RESTRICTED_PATTERNS,
          },
        ],
      },
    },
  ];
}

export const browserConfig: Linter.Config[] = createBrowserConfig();
export default browserConfig;
