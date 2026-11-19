import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface SecretFinding {
  readonly ruleId: string;
  readonly path: string;
  readonly line: number;
  readonly description: string;
}

interface SecretRule {
  readonly id: string;
  readonly description: string;
  readonly pattern: RegExp;
}

const SECRET_RULES: readonly SecretRule[] = [
  {
    id: "uo3-pem-private-key",
    description: "Обнаружен блок приватного PEM-ключа (BEGIN ... PRIVATE KEY)",
    pattern: /-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----/,
  },
  {
    id: "uo3-aws-access-key",
    description: "Обнаружен AWS Access Key ID",
    pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: "uo3-github-token",
    description: "Обнаружен токен GitHub",
    pattern: /\b(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})\b/,
  },
  {
    id: "uo3-google-api-key",
    description: "Обнаружен Google API Key",
    pattern: /\bAIza[0-9A-Za-z\-_]{35}\b/,
  },
  {
    id: "uo3-discord-token",
    description: "Обнаружен токен Discord Bot",
    pattern: /\b[MN][A-Za-z\d]{23}\.[\w-]{6}\.[\w-]{27}\b/,
  },
  {
    id: "uo3-hardcoded-uri-password",
    description: "Обнаружен реальный пароль в строке подключения URI",
    pattern:
      /(?:postgresql|postgres|redis|rediss|nats|amqp):\/\/[^:\s/]+:([^@\s]{12,})@(?!localhost|127\.0\.0\.1|postgres)/i,
  },
];

const ALLOWLIST_PLACEHOLDERS = ["CHANGE_ME_LOCAL_DEV_ONLY", "[REDACTED]", "example_placeholder"];

const IGNORED_PATH_PATTERNS: readonly RegExp[] = [
  /^pnpm-lock\.yaml$/,
  /\.gitleaks\.toml$/,
  /^scripts\/check-secrets(\.test)?\.ts$/,
  /^apps\/client\/src\/secret-guard\.ts$/,
  /^apps\/client\/src\/App\.test\.tsx$/,
  /^apps\/admin\/vite\.config\.ts$/,
  /^openspec\//,
];

function isAllowlistedLine(relPath: string, line: string): boolean {
  if (/(^|\/)\.env\.example$/.test(relPath) && line.includes("CHANGE_ME_LOCAL_DEV_ONLY")) {
    return true;
  }
  return ALLOWLIST_PLACEHOLDERS.some((marker) => line.includes(marker));
}

export function scanContentForSecrets(relPath: string, content: string): readonly SecretFinding[] {
  const normalizedPath = relPath.replace(/\\/g, "/");
  if (IGNORED_PATH_PATTERNS.some((p) => p.test(normalizedPath))) {
    return [];
  }

  const findings: SecretFinding[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isAllowlistedLine(normalizedPath, line)) {
      continue;
    }

    for (const rule of SECRET_RULES) {
      if (rule.pattern.test(line)) {
        findings.push({
          ruleId: rule.id,
          path: normalizedPath,
          line: i + 1,
          description: rule.description,
        });
      }
    }
  }

  return findings;
}

export function scanFilesForSecrets(
  rootDir: string,
  relativeFiles: readonly string[],
): readonly SecretFinding[] {
  const all: SecretFinding[] = [];

  for (const rawRel of relativeFiles) {
    const relPath = rawRel.replace(/\\/g, "/");
    const fullPath = join(rootDir, relPath);
    if (!existsSync(fullPath)) {
      continue;
    }
    const stat = statSync(fullPath);
    if (!stat.isFile() || stat.size > 1_048_576) {
      continue;
    }
    const buf = readFileSync(fullPath);
    if (buf.subarray(0, Math.min(buf.length, 4096)).includes(0)) {
      continue;
    }
    all.push(...scanContentForSecrets(relPath, buf.toString("utf8")));
  }

  return all;
}

export function formatSecretFindingsReport(findings: readonly SecretFinding[]): string {
  const header = `Обнаружены потенциальные утечки секретов (${findings.length}) [значения скрыты]:`;
  const lines = findings.map(
    (f) => `  - [${f.ruleId}] ${f.path}:${f.line} — ${f.description} ([REDACTED])`,
  );
  return [header, ...lines].join("\n");
}

function collectGitFiles(rootDir: string, staged: boolean): string[] {
  const args = staged
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACM"]
    : ["ls-files", "--cached", "--others", "--exclude-standard"];
  const res = spawnSync("git", args, { cwd: rootDir, encoding: "utf8" });
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
  const staged = process.argv.includes("--staged");
  const files = collectGitFiles(rootDir, staged);
  const findings = scanFilesForSecrets(rootDir, files);

  if (findings.length > 0) {
    process.stderr.write(`${formatSecretFindingsReport(findings)}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `Сканирование секретов пройдено: утечек не обнаружено (${files.length} файлов).\n`,
  );
}
