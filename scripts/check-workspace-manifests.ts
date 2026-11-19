import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface ManifestViolation {
  readonly file: string;
  readonly rule: string;
  readonly message: string;
}

export interface ManifestCheckOptions {
  readonly requireAll15?: boolean;
}

export const EXPECTED_APPS = [
  "client",
  "api",
  "game-server",
  "admin",
  "asset-tool",
  "bot-client",
] as const;

export const EXPECTED_PACKAGES = [
  "domain",
  "rules",
  "protocol",
  "uo-formats",
  "content",
  "db",
  "ui-kit",
  "config",
  "test-kit",
] as const;

const REQUIRED_NODE_ENGINE = ">=22.0.0 <23.0.0";

const BROWSER_MODULES = new Set(["@uo3/client", "@uo3/admin", "@uo3/ui-kit"]);
const SERVER_MODULES = new Set(["@uo3/api", "@uo3/game-server", "@uo3/db"]);
const NO_DB_MODULES = new Set([
  "@uo3/client",
  "@uo3/admin",
  "@uo3/ui-kit",
  "@uo3/bot-client",
  "@uo3/asset-tool",
  "@uo3/domain",
  "@uo3/rules",
  "@uo3/protocol",
  "@uo3/uo-formats",
  "@uo3/content",
  "@uo3/config",
]);

interface PackageJsonShape {
  readonly name?: string;
  readonly private?: boolean;
  readonly type?: string;
  readonly packageManager?: string;
  readonly engines?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly pnpm?: {
    readonly onlyBuiltDependencies?: unknown;
  };
}

function readJson(filePath: string): PackageJsonShape {
  return JSON.parse(readFileSync(filePath, "utf8")) as PackageJsonShape;
}

function listWorkspaceDirs(rootDir: string, parent: "apps" | "packages"): string[] {
  const dir = join(rootDir, parent);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() && existsSync(join(full, "package.json"));
    })
    .sort();
}

export function validateWorkspaceManifests(
  rootDir: string,
  options: ManifestCheckOptions = {},
): ManifestViolation[] {
  const violations: ManifestViolation[] = [];
  const rootPkgPath = join(rootDir, "package.json");

  if (!existsSync(rootPkgPath)) {
    violations.push({
      file: "package.json",
      rule: "root-manifest-exists",
      message: "Корневой package.json не найден.",
    });
    return violations;
  }

  const rootPkg = readJson(rootPkgPath);
  if (rootPkg.type !== "module") {
    violations.push({
      file: "package.json",
      rule: "esm-only",
      message: 'Корневой package.json должен задавать "type": "module".',
    });
  }
  if (rootPkg.engines?.["node"] !== REQUIRED_NODE_ENGINE) {
    violations.push({
      file: "package.json",
      rule: "engines-node",
      message: `Корневой engines.node должен быть "${REQUIRED_NODE_ENGINE}".`,
    });
  }
  if (!rootPkg.packageManager?.startsWith("pnpm@9.")) {
    violations.push({
      file: "package.json",
      rule: "package-manager",
      message: 'Корневой packageManager должен фиксировать точную версию "pnpm@9.x".',
    });
  }

  const onlyBuilt = rootPkg.pnpm?.onlyBuiltDependencies;
  if (
    !Array.isArray(onlyBuilt) ||
    onlyBuilt.length === 0 ||
    !onlyBuilt.every((item) => typeof item === "string" && item.length > 0)
  ) {
    violations.push({
      file: "package.json",
      rule: "pnpm-only-built-dependencies",
      message:
        "Корневой package.json должен объявлять явный непустой белый список pnpm.onlyBuiltDependencies.",
    });
  }

  const discoveredApps = listWorkspaceDirs(rootDir, "apps");
  const discoveredPackages = listWorkspaceDirs(rootDir, "packages");

  if (options.requireAll15) {
    for (const expected of EXPECTED_APPS) {
      if (!discoveredApps.includes(expected)) {
        violations.push({
          file: `apps/${expected}/package.json`,
          rule: "workspace-catalog",
          message: `Отсутствует обязательное приложение apps/${expected}.`,
        });
      }
    }
    for (const expected of EXPECTED_PACKAGES) {
      if (!discoveredPackages.includes(expected)) {
        violations.push({
          file: `packages/${expected}/package.json`,
          rule: "workspace-catalog",
          message: `Отсутствует обязательный пакет packages/${expected}.`,
        });
      }
    }
  }

  const modules: Array<{ readonly relDir: string; readonly kind: "apps" | "packages" }> = [
    ...discoveredPackages.map((d) => ({ relDir: `packages/${d}`, kind: "packages" as const })),
    ...discoveredApps.map((d) => ({ relDir: `apps/${d}`, kind: "apps" as const })),
  ];

  for (const mod of modules) {
    const pkgRelPath = `${mod.relDir}/package.json`;
    const fullDir = join(rootDir, mod.relDir);
    const pkg = readJson(join(fullDir, "package.json"));
    const pkgName = pkg.name ?? "";

    if (!pkgName.startsWith("@uo3/")) {
      violations.push({
        file: pkgRelPath,
        rule: "uo3-scope",
        message: `Имя пакета "${pkgName}" должно быть в области @uo3/*.`,
      });
    }

    if (pkg.type !== "module") {
      violations.push({
        file: pkgRelPath,
        rule: "esm-only",
        message: `Модуль ${pkgName} должен задавать "type": "module".`,
      });
    }

    if (pkg.engines?.["node"] !== REQUIRED_NODE_ENGINE) {
      violations.push({
        file: pkgRelPath,
        rule: "engines-node",
        message: `Модуль ${pkgName} должен задавать engines.node = "${REQUIRED_NODE_ENGINE}".`,
      });
    }

    if (!existsSync(join(fullDir, "tsconfig.json"))) {
      violations.push({
        file: `${mod.relDir}/tsconfig.json`,
        rule: "tsconfig-required",
        message: `В модуле ${pkgName} отсутствует tsconfig.json.`,
      });
    }

    const depSections: Array<readonly [string, Record<string, string> | undefined]> = [
      ["dependencies", pkg.dependencies],
      ["devDependencies", pkg.devDependencies],
      ["peerDependencies", pkg.peerDependencies],
    ];

    for (const [section, deps] of depSections) {
      if (!deps) {
        continue;
      }
      for (const [depName, depVersion] of Object.entries(deps)) {
        if (depName.startsWith("@uo3/") && depVersion !== "workspace:*") {
          violations.push({
            file: pkgRelPath,
            rule: "workspace-protocol",
            message: `Внутренняя зависимость ${depName} в ${section} должна использовать "workspace:*", найдено "${depVersion}".`,
          });
        }
      }
    }

    const runtimeDeps = Object.keys(pkg.dependencies ?? {});

    if (runtimeDeps.includes("@uo3/test-kit")) {
      violations.push({
        file: pkgRelPath,
        rule: "test-kit-dev-only",
        message: `@uo3/test-kit запрещён в dependencies модуля ${pkgName}; используйте только devDependencies.`,
      });
    }

    if (pkgName === "@uo3/domain") {
      const forbiddenDomainDeps = runtimeDeps.filter((dep) => dep !== "@sinclair/typebox");
      if (forbiddenDomainDeps.length > 0) {
        violations.push({
          file: pkgRelPath,
          rule: "domain-pure-dependencies",
          message: `@uo3/domain допускает в dependencies только @sinclair/typebox (или пустой список); найдены: ${forbiddenDomainDeps.join(", ")}.`,
        });
      }
    }

    if (NO_DB_MODULES.has(pkgName) && runtimeDeps.includes("@uo3/db")) {
      violations.push({
        file: pkgRelPath,
        rule: "no-db-dependency",
        message: `Модуль ${pkgName} не имеет права зависеть от @uo3/db.`,
      });
    }

    if (SERVER_MODULES.has(pkgName) && runtimeDeps.includes("@uo3/ui-kit")) {
      violations.push({
        file: pkgRelPath,
        rule: "no-ui-kit-in-server",
        message: `Серверный модуль ${pkgName} не имеет права зависеть от @uo3/ui-kit.`,
      });
    }

    if (BROWSER_MODULES.has(pkgName) && runtimeDeps.includes("@uo3/db")) {
      violations.push({
        file: pkgRelPath,
        rule: "no-db-in-browser",
        message: `Браузерный модуль ${pkgName} не имеет права зависеть от @uo3/db.`,
      });
    }
  }

  return violations;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const rootDir = resolve(import.meta.dirname, "..");
  const requireAll15 = !process.argv.includes("--allow-partial");
  const violations = validateWorkspaceManifests(rootDir, { requireAll15 });

  if (violations.length > 0) {
    process.stderr.write(
      `Найдены нарушения манифестов рабочего пространства (${violations.length}):\n`,
    );
    for (const v of violations) {
      process.stderr.write(`  - [${v.rule}] ${v.file}: ${v.message}\n`);
    }
    process.exit(1);
  }

  process.stdout.write("Все манифесты рабочего пространства прошли проверку.\n");
}
