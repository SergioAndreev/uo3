/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies are strictly forbidden across the monorepo DAG.",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "no-import-from-apps",
      severity: "error",
      comment: "Nothing in packages/* or another app may import from apps/*.",
      from: {
        path: "^(packages|apps)/([^/]+)/",
      },
      to: {
        path: "^apps/([^/]+)/",
        pathNot: "^apps/$2/",
      },
    },
    {
      name: "no-packages-importing-apps",
      severity: "error",
      comment: "Packages must never import from any application.",
      from: {
        path: "^packages/",
      },
      to: {
        path: "^apps/",
      },
    },
    {
      name: "no-server-or-node-in-browser",
      severity: "error",
      comment:
        "Browser modules must not import @uo3/db, @uo3/config/env/server, or Node built-ins.",
      from: {
        path: "^(apps/(client|admin)/src/|packages/ui-kit/src/|packages/config/src/env/client/)",
        pathNot: "\\.(test|integration\\.test)\\.tsx?$",
      },
      to: {
        path: "^(packages/db|packages/config/(src|dist)/env/server|node_modules/(@uo3/db|@nestjs|colyseus))",
      },
    },
    {
      name: "no-node-builtins-in-browser",
      severity: "error",
      comment: "Browser modules must not import Node.js core built-in modules.",
      from: {
        path: "^(apps/(client|admin)/src/|packages/ui-kit/src/|packages/config/src/env/client/)",
        pathNot: "\\.(test|integration\\.test)\\.tsx?$",
      },
      to: {
        dependencyTypes: ["core"],
      },
    },
    {
      name: "no-browser-ui-in-server",
      severity: "error",
      comment:
        "Server and CLI/bot modules must not import @uo3/ui-kit or browser UI frameworks (server -> browser-ui).",
      from: {
        path: "^(apps/(api|game-server|asset-tool|bot-client)/src/|packages/db/src/)",
        pathNot: "\\.(test|integration\\.test)\\.ts$",
      },
      to: {
        path: "^(packages/ui-kit|node_modules/(@uo3/ui-kit|react|react-dom|three|@react-three))",
      },
    },
    {
      name: "no-db-in-cli-or-bot",
      severity: "error",
      comment: "apps/bot-client and apps/asset-tool must not access @uo3/db directly.",
      from: {
        path: "^apps/(bot-client|asset-tool)/src/",
        pathNot: "\\.(test|integration\\.test)\\.ts$",
      },
      to: {
        path: "^(packages/db|node_modules/@uo3/db)",
      },
    },
    {
      name: "no-node-builtins-in-isomorphic-core",
      severity: "error",
      comment:
        "Isomorphic core packages (domain, rules, protocol, uo-formats) must not use Node built-ins.",
      from: {
        path: "^packages/(domain|rules|protocol|uo-formats)/src/",
        pathNot: "\\.(test|integration\\.test)\\.ts$",
      },
      to: {
        dependencyTypes: ["core"],
      },
    },
    {
      name: "no-platform-pkgs-in-isomorphic",
      severity: "error",
      comment: "Isomorphic packages must not depend on platform packages (@uo3/db, @uo3/ui-kit).",
      from: {
        path: "^packages/(domain|rules|protocol|uo-formats|content)/src/",
        pathNot: "\\.(test|integration\\.test)\\.ts$",
      },
      to: {
        path: "^(packages/(db|ui-kit)|node_modules/@uo3/(db|ui-kit))",
      },
    },
    {
      name: "domain-layer-pure",
      severity: "error",
      comment: "@uo3/domain must not depend on any other @uo3/* package.",
      from: {
        path: "^packages/domain/src/",
        pathNot: "\\.(test|integration\\.test)\\.ts$",
      },
      to: {
        path: "^packages/(?!domain/)",
      },
    },
    {
      name: "no-test-kit-in-production",
      severity: "error",
      comment: "Dev-only @uo3/test-kit must not be imported from production code.",
      from: {
        path: "^(apps|packages)/[^/]+/src/",
        pathNot: "(^packages/test-kit/|\\.(test|integration\\.test)\\.tsx?$)",
      },
      to: {
        path: "^(packages/test-kit|node_modules/@uo3/test-kit)",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: "(^|/)dist/|(^|/)coverage/|(^|/)\\.turbo/|\\.d\\.ts$",
    },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".json"],
    },
  },
};
