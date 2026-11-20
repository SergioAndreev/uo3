import type { ESLint, Linter } from "eslint";
import boundaries from "eslint-plugin-boundaries";

export const BOUNDARY_ELEMENTS = [
  { type: "app-client", pattern: "apps/client/**" },
  { type: "app-admin", pattern: "apps/admin/**" },
  { type: "app-api", pattern: "apps/api/**" },
  { type: "app-game-server", pattern: "apps/game-server/**" },
  { type: "app-asset-tool", pattern: "apps/asset-tool/**" },
  { type: "app-bot-client", pattern: "apps/bot-client/**" },
  { type: "pkg-config", pattern: "packages/config/**" },
  { type: "pkg-domain", pattern: "packages/domain/**" },
  { type: "pkg-rules", pattern: "packages/rules/**" },
  { type: "pkg-protocol", pattern: "packages/protocol/**" },
  { type: "pkg-uo-formats", pattern: "packages/uo-formats/**" },
  { type: "pkg-content", pattern: "packages/content/**" },
  { type: "pkg-db", pattern: "packages/db/**" },
  { type: "pkg-ui-kit", pattern: "packages/ui-kit/**" },
  { type: "pkg-test-kit", pattern: "packages/test-kit/**" },
] as const;

export function createBoundariesConfig(): Linter.Config[] {
  return [
    {
      name: "uo3/boundaries-plugin",
      files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
      plugins: {
        boundaries: boundaries as unknown as ESLint.Plugin,
      },
      settings: {
        "boundaries/elements": BOUNDARY_ELEMENTS,
      },
      rules: {
        "boundaries/element-types": [
          "error",
          {
            default: "disallow",
            rules: [
              { from: "pkg-config", allow: ["pkg-config"] },
              { from: "pkg-domain", allow: ["pkg-domain"] },
              { from: "pkg-rules", allow: ["pkg-rules", "pkg-domain"] },
              { from: "pkg-protocol", allow: ["pkg-protocol", "pkg-domain"] },
              { from: "pkg-uo-formats", allow: ["pkg-uo-formats", "pkg-domain"] },
              { from: "pkg-content", allow: ["pkg-content", "pkg-domain", "pkg-rules"] },
              { from: "pkg-db", allow: ["pkg-db", "pkg-domain", "pkg-config"] },
              {
                from: "pkg-ui-kit",
                allow: ["pkg-ui-kit", "pkg-domain", "pkg-protocol", "pkg-config"],
              },
              {
                from: "pkg-test-kit",
                allow: [
                  "pkg-test-kit",
                  "pkg-domain",
                  "pkg-rules",
                  "pkg-protocol",
                  "pkg-uo-formats",
                  "pkg-content",
                  "pkg-config",
                ],
              },
              {
                from: "app-client",
                allow: [
                  "app-client",
                  "pkg-domain",
                  "pkg-rules",
                  "pkg-protocol",
                  "pkg-uo-formats",
                  "pkg-content",
                  "pkg-ui-kit",
                  "pkg-config",
                ],
              },
              {
                from: "app-admin",
                allow: [
                  "app-admin",
                  "pkg-domain",
                  "pkg-protocol",
                  "pkg-content",
                  "pkg-ui-kit",
                  "pkg-config",
                ],
              },
              {
                from: "app-api",
                allow: [
                  "app-api",
                  "pkg-domain",
                  "pkg-rules",
                  "pkg-protocol",
                  "pkg-content",
                  "pkg-db",
                  "pkg-config",
                ],
              },
              {
                from: "app-game-server",
                allow: [
                  "app-game-server",
                  "pkg-domain",
                  "pkg-rules",
                  "pkg-protocol",
                  "pkg-uo-formats",
                  "pkg-content",
                  "pkg-db",
                  "pkg-config",
                ],
              },
              {
                from: "app-asset-tool",
                allow: [
                  "app-asset-tool",
                  "pkg-domain",
                  "pkg-uo-formats",
                  "pkg-content",
                  "pkg-config",
                ],
              },
              {
                from: "app-bot-client",
                allow: ["app-bot-client", "pkg-domain", "pkg-rules", "pkg-protocol", "pkg-config"],
              },
            ],
          },
        ],
      },
    },
    {
      name: "uo3/isomorphic-core-isolation",
      files: [
        "packages/domain/src/**/*.ts",
        "packages/rules/src/**/*.ts",
        "packages/protocol/src/**/*.ts",
        "packages/uo-formats/src/**/*.ts",
      ],
      ignores: ["**/*.test.ts", "**/*.integration.test.ts"],
      rules: {
        "no-restricted-globals": [
          "error",
          { name: "window", message: "DOM global 'window' is forbidden in isomorphic packages." },
          {
            name: "document",
            message: "DOM global 'document' is forbidden in isomorphic packages.",
          },
          {
            name: "localStorage",
            message: "DOM global 'localStorage' is forbidden in isomorphic packages.",
          },
          {
            name: "sessionStorage",
            message: "DOM global 'sessionStorage' is forbidden in isomorphic packages.",
          },
        ],
        "no-restricted-imports": [
          "error",
          {
            paths: [
              { name: "@uo3/db", message: "Isomorphic packages must not import @uo3/db." },
              { name: "@uo3/ui-kit", message: "Isomorphic packages must not import @uo3/ui-kit." },
              {
                name: "@uo3/test-kit",
                message: "Production code must not import dev-only @uo3/test-kit.",
              },
            ],
            patterns: [
              {
                group: ["node:*", "fs", "fs/*", "net", "http", "https", "child_process"],
                message: "Node.js built-ins are forbidden in isomorphic core packages.",
              },
              {
                group: [
                  "@uo3/client",
                  "@uo3/admin",
                  "@uo3/api",
                  "@uo3/game-server",
                  "@uo3/asset-tool",
                  "@uo3/bot-client",
                ],
                message: "Packages must never import from applications.",
              },
            ],
          },
        ],
      },
    },
    {
      name: "uo3/domain-rules-determinism",
      files: ["packages/domain/src/**/*.ts", "packages/rules/src/**/*.ts"],
      ignores: [
        "**/*.test.ts",
        "**/*.integration.test.ts",
        "packages/domain/src/runtime/system-clock.ts",
      ],
      rules: {
        "no-restricted-properties": [
          "error",
          {
            object: "Math",
            property: "random",
            message:
              "Math.random() is forbidden in deterministic core packages (@uo3/domain, @uo3/rules); inject SeededRng.",
          },
          {
            object: "Date",
            property: "now",
            message:
              "Date.now() is forbidden in deterministic core packages (@uo3/domain, @uo3/rules); inject GameClock.",
          },
          {
            object: "performance",
            property: "now",
            message:
              "performance.now() is forbidden in deterministic core packages (@uo3/domain, @uo3/rules); inject GameClock.",
          },
          {
            object: "process",
            property: "env",
            message:
              "process.env is forbidden in pure isomorphic packages (@uo3/domain, @uo3/rules).",
          },
        ],
        "no-restricted-syntax": [
          "error",
          {
            selector: "NewExpression[callee.name='Date'][arguments.length=0]",
            message:
              "new Date() without arguments is non-deterministic in @uo3/domain and @uo3/rules; inject GameClock.",
          },
        ],
      },
    },
    {
      name: "uo3/cli-and-bot-db-isolation",
      files: ["apps/bot-client/src/**/*.ts", "apps/asset-tool/src/**/*.ts"],
      ignores: ["**/*.test.ts", "**/*.integration.test.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "@uo3/db",
                message: "apps/bot-client and apps/asset-tool must not access @uo3/db directly.",
              },
              {
                name: "@uo3/ui-kit",
                message: "CLI and bot applications must not import @uo3/ui-kit.",
              },
              {
                name: "@uo3/test-kit",
                message: "Production code must not import dev-only @uo3/test-kit.",
              },
            ],
          },
        ],
      },
    },
    {
      name: "uo3/config-no-test-kit-in-production",
      files: ["packages/config/src/**/*.ts"],
      ignores: ["packages/config/src/env/client/**", "**/*.test.ts", "**/*.integration.test.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "@uo3/test-kit",
                message: "Dev-only package @uo3/test-kit must not be imported in production code.",
              },
            ],
          },
        ],
      },
    },
    {
      name: "uo3/content-isolation",
      files: ["packages/content/src/**/*.ts"],
      ignores: ["**/*.test.ts", "**/*.integration.test.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              { name: "@uo3/db", message: "@uo3/content must not import @uo3/db." },
              { name: "@uo3/ui-kit", message: "@uo3/content must not import @uo3/ui-kit." },
              {
                name: "@uo3/test-kit",
                message: "Dev-only package @uo3/test-kit must not be imported in production code.",
              },
            ],
          },
        ],
      },
    },
  ];
}

export const boundariesConfig: Linter.Config[] = createBoundariesConfig();
export default boundariesConfig;
