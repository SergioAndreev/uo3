import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface AuditWaiver {
  readonly advisoryId: string;
  readonly package: string;
  readonly reason: string;
  readonly owner: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface AuditWaiversFile {
  readonly waivers: readonly AuditWaiver[];
}

export interface AuditAdvisory {
  readonly id?: number | string;
  readonly github_advisory_id?: string;
  readonly module_name: string;
  readonly severity: string;
  readonly title?: string;
  readonly url?: string;
}

export interface PnpmAuditJson {
  readonly advisories?: Record<string, AuditAdvisory>;
}

export interface AuditCheckReport {
  readonly ok: boolean;
  readonly waiverErrors: readonly string[];
  readonly blockedAdvisories: readonly string[];
}

const MAX_WAIVER_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const BLOCKED_SEVERITIES = new Set(["critical", "high"]);

export function validateWaivers(
  waivers: readonly AuditWaiver[],
  now: Date = new Date(),
): readonly string[] {
  const errors: string[] = [];

  for (const w of waivers) {
    const createdMs = Date.parse(w.createdAt);
    const expiresMs = Date.parse(w.expiresAt);

    if (Number.isNaN(createdMs) || Number.isNaN(expiresMs)) {
      errors.push(
        `Waiver ${w.advisoryId} (${w.package}) содержит некорректную дату createdAt/expiresAt.`,
      );
      continue;
    }

    if (expiresMs <= now.getTime()) {
      errors.push(
        `Waiver ${w.advisoryId} (${w.package}) истёк (${w.expiresAt}). Обновите зависимость или пересмотрите исключение.`,
      );
      continue;
    }

    if (expiresMs - createdMs > MAX_WAIVER_DURATION_MS) {
      errors.push(
        `Waiver ${w.advisoryId} (${w.package}) превышает максимально допустимый срок действия 30 дней.`,
      );
    }
  }

  return errors;
}

export function evaluateAuditReport(
  auditJson: PnpmAuditJson,
  waivers: readonly AuditWaiver[],
  now: Date = new Date(),
): AuditCheckReport {
  const waiverErrors = validateWaivers(waivers, now);
  const activeWaivers = new Set(
    waivers
      .filter((w) => {
        const createdMs = Date.parse(w.createdAt);
        const expiresMs = Date.parse(w.expiresAt);
        return (
          !Number.isNaN(createdMs) &&
          !Number.isNaN(expiresMs) &&
          expiresMs > now.getTime() &&
          expiresMs - createdMs <= MAX_WAIVER_DURATION_MS
        );
      })
      .map((w) => `${w.advisoryId}::${w.package}`),
  );

  const blockedAdvisories: string[] = [];
  for (const [key, adv] of Object.entries(auditJson.advisories ?? {})) {
    const severity = (adv.severity ?? "").toLowerCase();
    if (!BLOCKED_SEVERITIES.has(severity)) {
      continue;
    }

    const ids = [key, String(adv.id ?? ""), adv.github_advisory_id ?? ""].filter(
      (id) => id.length > 0,
    );
    const isWaived = ids.some((id) => activeWaivers.has(`${id}::${adv.module_name}`));
    if (!isWaived) {
      blockedAdvisories.push(
        `[${severity.toUpperCase()}] ${adv.module_name} (${adv.github_advisory_id ?? key}): ${adv.title ?? "Vulnerability"}`,
      );
    }
  }

  return {
    ok: waiverErrors.length === 0 && blockedAdvisories.length === 0,
    waiverErrors,
    blockedAdvisories,
  };
}

export function loadAuditWaivers(rootDir: string): AuditWaiversFile {
  const filePath = join(rootDir, "config/security/audit-waivers.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as AuditWaiversFile;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const rootDir = resolve(import.meta.dirname, "..");
  const { waivers } = loadAuditWaivers(rootDir);

  const res = spawnSync("pnpm", ["audit", "--prod", "--json"], {
    cwd: rootDir,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 16 * 1024 * 1024,
  });

  let parsed: PnpmAuditJson = { advisories: {} };
  try {
    parsed = JSON.parse(res.stdout || "{}") as PnpmAuditJson;
  } catch {
    process.stderr.write(`Не удалось разобрать JSON-вывод \`pnpm audit --prod --json\`.\n`);
    process.exit(1);
  }

  const report = evaluateAuditReport(parsed, waivers);
  if (!report.ok) {
    for (const err of report.waiverErrors) {
      process.stderr.write(`FAIL [waiver]: ${err}\n`);
    }
    for (const adv of report.blockedAdvisories) {
      process.stderr.write(`FAIL [audit]: ${adv}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    "Аудит производственных зависимостей пройден: critical/high уязвимостей нет.\n",
  );
}
