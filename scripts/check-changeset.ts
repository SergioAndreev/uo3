import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface ChangesetCheckInput {
  readonly changedFiles: readonly string[];
  readonly prLabels?: readonly string[];
}

export interface ChangesetCheckResult {
  readonly ok: boolean;
  readonly requiresChangeset: boolean;
  readonly hasChangesetFile: boolean;
  readonly exemptedByLabel: boolean;
  readonly message: string;
}

const EXEMPT_LABELS = new Set(["no-changeset-needed", "skip-changeset"]);

export function isProductionSourceFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (!/^(apps|packages)\/[^/]+\/src\//.test(normalized)) {
    return false;
  }
  if (/^packages\/test-kit\//.test(normalized)) {
    return false;
  }
  if (/\.(test|integration\.test)\.(ts|tsx)$/.test(normalized)) {
    return false;
  }
  return true;
}

export function isChangesetMarkdownFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return /^\.changeset\/[^/]+\.md$/.test(normalized) && normalized !== ".changeset/README.md";
}

export function evaluateChangesetRequirement(input: ChangesetCheckInput): ChangesetCheckResult {
  const prodFiles = input.changedFiles.filter(isProductionSourceFile);
  const requiresChangeset = prodFiles.length > 0;
  const hasChangesetFile = input.changedFiles.some(isChangesetMarkdownFile);
  const exemptedByLabel = (input.prLabels ?? []).some((label) =>
    EXEMPT_LABELS.has(label.trim().toLowerCase()),
  );

  if (!requiresChangeset) {
    return {
      ok: true,
      requiresChangeset: false,
      hasChangesetFile,
      exemptedByLabel,
      message:
        "Производственный код apps/*/src или packages/*/src не затронут — changeset не требуется.",
    };
  }

  if (hasChangesetFile) {
    return {
      ok: true,
      requiresChangeset: true,
      hasChangesetFile: true,
      exemptedByLabel,
      message: "Найден валидный файл changeset для производственных изменений.",
    };
  }

  if (exemptedByLabel) {
    return {
      ok: true,
      requiresChangeset: true,
      hasChangesetFile: false,
      exemptedByLabel: true,
      message: "Изменение освобождено от changeset меткой PR (no-changeset-needed).",
    };
  }

  return {
    ok: false,
    requiresChangeset: true,
    hasChangesetFile: false,
    exemptedByLabel: false,
    message: `Обнаружены изменения производственного кода (${prodFiles.slice(0, 5).join(", ")}), но отсутствует файл .changeset/*.md. Запустите \`pnpm exec changeset\` или добавьте метку \`no-changeset-needed\` к PR.`,
  };
}

function getGitChangedFiles(rootDir: string, baseRef: string): string[] {
  const res = spawnSync("git", ["diff", "--name-only", `${baseRef}...HEAD`], {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    return [];
  }
  return res.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const rootDir = resolve(import.meta.dirname, "..");
  const baseRef = process.env["CHANGESET_BASE_REF"] ?? "origin/main";
  const labelsRaw = process.env["PR_LABELS"] ?? "";
  const prLabels = labelsRaw
    .split(",")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const changedFiles = getGitChangedFiles(rootDir, baseRef);
  const result = evaluateChangesetRequirement({ changedFiles, prLabels });

  if (!result.ok) {
    process.stderr.write(`FAIL [changeset]: ${result.message}\n`);
    process.exit(1);
  }
  process.stdout.write(`PASS [changeset]: ${result.message}\n`);
}
