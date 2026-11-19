import type { Linter } from "eslint";

export const SERVER_RESTRICTED_IMPORTS = [
  {
    name: "@uo3/ui-kit",
    message: "Server modules must not import browser-only @uo3/ui-kit (server -> browser-ui).",
  },
  {
    name: "@uo3/test-kit",
    message: "Dev-only package @uo3/test-kit must not be imported in production code.",
  },
  {
    name: "react",
    message: "Server modules must not import React.",
  },
  {
    name: "react-dom",
    message: "Server modules must not import ReactDOM.",
  },
  {
    name: "three",
    message: "Server modules must not import Three.js.",
  },
];

export const SERVER_RESTRICTED_PATTERNS = [
  {
    group: ["@react-three/*"],
    message: "Server modules must not import @react-three/*.",
  },
  {
    group: ["@uo3/client", "@uo3/admin"],
    message: "Server modules must not import browser applications.",
  },
];

export function createServerConfig(
  files: string[] = [
    "apps/api/src/**/*.ts",
    "apps/game-server/src/**/*.ts",
    "packages/db/src/**/*.ts",
  ],
): Linter.Config[] {
  return [
    {
      name: "uo3/server-isolation",
      files,
      ignores: ["**/*.test.ts", "**/*.integration.test.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: SERVER_RESTRICTED_IMPORTS,
            patterns: SERVER_RESTRICTED_PATTERNS,
          },
        ],
      },
    },
  ];
}

export const serverConfig: Linter.Config[] = createServerConfig();
export default serverConfig;
