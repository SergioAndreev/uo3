import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface LicenseException {
  readonly package: string;
  readonly license: string;
  readonly reason: string;
  readonly approvedBy: string;
}

export interface LicensePolicy {
  readonly allowedSpdx: readonly string[];
  readonly deniedPatterns: readonly string[];
  readonly exceptions: readonly LicenseException[];
}

export interface PnpmLicenseEntry {
  readonly name: string;
  readonly versions?: readonly string[];
  readonly paths?: readonly string[];
  readonly license?: string;
}

export type PnpmLicensesJson = Record<string, readonly PnpmLicenseEntry[]>;

export interface LicenseViolation {
  readonly packageName: string;
  readonly versions: readonly string[];
  readonly license: string;
  readonly paths: readonly string[];
  readonly reason: string;
}

export function isLicenseExpressionAllowed(
  rawLicense: string,
  allowedSet: ReadonlySet<string>,
  deniedPatterns: readonly string[],
): boolean {
  const cleaned = rawLicense.trim().replace(/^\(+|\)+$/g, "");
  if (cleaned.length === 0) {
    return false;
  }

  // Handle OR expressions: allowed if ANY branch is allowed
  if (/\s+OR\s+/i.test(cleaned)) {
    const branches = cleaned.split(/\s+OR\s+/i).map((b) => b.trim());
    return branches.some((branch) =>
      isLicenseExpressionAllowed(branch, allowedSet, deniedPatterns),
    );
  }

  // Handle AND expressions: allowed only if ALL branches are allowed
  if (/\s+AND\s+/i.test(cleaned)) {
    const parts = cleaned.split(/\s+AND\s+/i).map((p) => p.trim());
    return parts.every((part) => isLicenseExpressionAllowed(part, allowedSet, deniedPatterns));
  }

  const upper = cleaned.toUpperCase();
  if (deniedPatterns.some((denied) => upper.includes(denied.toUpperCase()))) {
    return false;
  }

  return allowedSet.has(cleaned);
}

export function evaluateLicenses(
  licensesJson: PnpmLicensesJson,
  policy: LicensePolicy,
): readonly LicenseViolation[] {
  const allowedSet = new Set(policy.allowedSpdx);
  const violations: LicenseViolation[] = [];

  for (const [licenseKey, entries] of Object.entries(licensesJson)) {
    const licenseExpr = licenseKey.trim() || "UNKNOWN";
    const exprAllowed = isLicenseExpressionAllowed(licenseExpr, allowedSet, policy.deniedPatterns);
    if (exprAllowed) {
      continue;
    }

    for (const entry of entries) {
      const hasException = policy.exceptions.some(
        (ex) => ex.package === entry.name && ex.license === licenseExpr,
      );
      if (hasException) {
        continue;
      }

      violations.push({
        packageName: entry.name,
        versions: entry.versions ?? [],
        license: licenseExpr,
        paths: entry.paths ?? [],
        reason: `Лицензия "${licenseExpr}" не входит в белый список SPDX или подпадает под запрещённый шаблон.`,
      });
    }
  }

  return violations;
}

export function loadLicensePolicy(rootDir: string): LicensePolicy {
  const policyPath = join(rootDir, "config/security/licenses.policy.json");
  return JSON.parse(readFileSync(policyPath, "utf8")) as LicensePolicy;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const rootDir = resolve(import.meta.dirname, "..");
  const policy = loadLicensePolicy(rootDir);

  const res = spawnSync("pnpm", ["licenses", "list", "--json"], {
    cwd: rootDir,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 32 * 1024 * 1024,
  });

  if (res.status !== 0) {
    process.stderr.write(`Ошибка выполнения \`pnpm licenses list --json\`: ${res.stderr}\n`);
    process.exit(1);
  }

  const parsed = JSON.parse(res.stdout) as PnpmLicensesJson;
  const violations = evaluateLicenses(parsed, policy);

  if (violations.length > 0) {
    process.stderr.write(`Обнаружены недопустимые лицензии зависимостей (${violations.length}):\n`);
    for (const v of violations) {
      process.stderr.write(
        `  - ${v.packageName}@${v.versions.join(",")} [${v.license}]: ${v.reason} (paths: ${v.paths.join(", ")})\n`,
      );
    }
    process.exit(1);
  }

  const licenseCount = Object.keys(parsed).length;
  process.stdout.write(
    `Проверка лицензий SPDX пройдена (проверено групп лицензий: ${licenseCount}).\n`,
  );
}
