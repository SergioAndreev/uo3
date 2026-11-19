import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

export interface CiIntegrityViolation {
  readonly file: string;
  readonly rule: string;
  readonly message: string;
}

const PINNED_SHA_REGEX = /^[^/]+\/[^@]+@[0-9a-f]{40}$/;

function collectYamlFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) {
    return acc;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectYamlFiles(full, acc);
    } else if (/\.ya?ml$/i.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function collectUsesReferences(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectUsesReferences(item, out);
    }
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "uses" && typeof v === "string") {
        out.push(v.trim());
      } else {
        collectUsesReferences(v, out);
      }
    }
  }
  return out;
}

interface WorkflowShape {
  readonly permissions?: Record<string, string>;
  readonly concurrency?: {
    readonly "cancel-in-progress"?: unknown;
  };
  readonly jobs?: Record<
    string,
    {
      readonly name?: string;
      readonly if?: string;
      readonly needs?: string | readonly string[];
      readonly services?: Record<string, { readonly image?: string }>;
      readonly steps?: ReadonlyArray<{
        readonly uses?: string;
        readonly if?: string;
        readonly with?: Record<string, unknown>;
      }>;
    }
  >;
}

interface RulesetShape {
  readonly conditions?: {
    readonly ref_name?: {
      readonly include?: readonly string[];
    };
  };
  readonly rules?: ReadonlyArray<{
    readonly type?: string;
    readonly parameters?: {
      readonly required_approving_review_count?: number;
      readonly strict_required_status_checks_policy?: boolean;
      readonly required_status_checks?: ReadonlyArray<{ readonly context?: string }>;
    };
  }>;
}

export function validateCiIntegrity(rootDir: string): readonly CiIntegrityViolation[] {
  const violations: CiIntegrityViolation[] = [];

  const workflowFiles = collectYamlFiles(join(rootDir, ".github/workflows"));
  const actionFiles = collectYamlFiles(join(rootDir, ".github/actions"));

  if (workflowFiles.length === 0) {
    violations.push({
      file: ".github/workflows",
      rule: "workflows-present",
      message: "Не найден ни один workflow-файл в .github/workflows/.",
    });
    return violations;
  }

  for (const fullPath of [...workflowFiles, ...actionFiles]) {
    const relPath = fullPath.slice(rootDir.length + 1).replace(/\\/g, "/");
    const parsed = parseYaml(readFileSync(fullPath, "utf8")) as WorkflowShape;

    const usesRefs = collectUsesReferences(parsed);
    for (const ref of usesRefs) {
      if (ref.startsWith("./")) {
        continue;
      }
      if (!PINNED_SHA_REGEX.test(ref)) {
        violations.push({
          file: relPath,
          rule: "action-sha-pinning",
          message: `Внешний GitHub Action "${ref}" не зафиксирован по полному 40-символьному commit SHA.`,
        });
      }
    }

    if (relPath.startsWith(".github/workflows/")) {
      const perms = parsed.permissions;
      if (!perms || perms["contents"] !== "read" || Object.keys(perms).length !== 1) {
        violations.push({
          file: relPath,
          rule: "least-privilege-permissions",
          message:
            "Workflow должен явно объявлять верхнеуровневые права `permissions: { contents: read }`.",
        });
      }
    }
  }

  // Validate ruleset + ci.yml agreement + Docker image parity with docker-compose.yml
  const ciPath = join(rootDir, ".github/workflows/ci.yml");
  const rulesetPath = join(rootDir, ".github/rulesets/main.json");
  const composePath = join(rootDir, "docker-compose.yml");

  if (!existsSync(ciPath)) {
    violations.push({
      file: ".github/workflows/ci.yml",
      rule: "ci-workflow-exists",
      message: "Отсутствует основной workflow .github/workflows/ci.yml.",
    });
    return violations;
  }

  const ci = parseYaml(readFileSync(ciPath, "utf8")) as WorkflowShape;

  if (!existsSync(rulesetPath)) {
    violations.push({
      file: ".github/rulesets/main.json",
      rule: "ruleset-exists",
      message: "Отсутствует спецификация защиты ветки .github/rulesets/main.json.",
    });
  } else {
    const ruleset = JSON.parse(readFileSync(rulesetPath, "utf8")) as RulesetShape;
    const includesMain = ruleset.conditions?.ref_name?.include?.includes("refs/heads/main");
    if (!includesMain) {
      violations.push({
        file: ".github/rulesets/main.json",
        rule: "ruleset-target-main",
        message: 'Ruleset должен защищать ветку "refs/heads/main".',
      });
    }

    const ruleTypes = new Set((ruleset.rules ?? []).map((r) => r.type));
    for (const requiredType of [
      "deletion",
      "non_fast_forward",
      "pull_request",
      "required_status_checks",
    ]) {
      if (!ruleTypes.has(requiredType)) {
        violations.push({
          file: ".github/rulesets/main.json",
          rule: "ruleset-required-rules",
          message: `В ruleset отсутствует обязательное правило "${requiredType}".`,
        });
      }
    }

    const statusRule = (ruleset.rules ?? []).find((r) => r.type === "required_status_checks");
    const contexts = (statusRule?.parameters?.required_status_checks ?? [])
      .map((c) => c.context)
      .filter((c): c is string => typeof c === "string");

    const ciJobs = ci.jobs ?? {};
    const ciJobNames = new Set(
      Object.entries(ciJobs).flatMap(([id, job]) => [id, ...(job.name ? [job.name] : [])]),
    );

    for (const ctx of contexts) {
      if (!ciJobNames.has(ctx)) {
        violations.push({
          file: ".github/rulesets/main.json",
          rule: "ruleset-ci-status-match",
          message: `Обязательная проверка "${ctx}" из ruleset отсутствует в .github/workflows/ci.yml.`,
        });
      }
    }
  }

  // Validate artifact upload steps use if: always()
  for (const jobId of ["test", "build"]) {
    const job = ci.jobs?.[jobId];
    const uploadSteps = (job?.steps ?? []).filter((s) =>
      s.uses?.startsWith("actions/upload-artifact@"),
    );
    if (uploadSteps.length === 0) {
      violations.push({
        file: ".github/workflows/ci.yml",
        rule: "ci-artifacts-upload",
        message: `Джоб "${jobId}" должен публиковать диагностические/сборочные артефакты.`,
      });
    }
    for (const step of uploadSteps) {
      if (step.if !== "always()") {
        violations.push({
          file: ".github/workflows/ci.yml",
          rule: "ci-artifacts-always",
          message: `Шаг загрузки артефактов в джобе "${jobId}" должен задавать \`if: always()\`.`,
        });
      }
    }
  }

  // Validate Docker image parity between docker-compose.yml and ci.yml services
  if (existsSync(composePath)) {
    const compose = parseYaml(readFileSync(composePath, "utf8")) as {
      services?: Record<string, { image?: string }>;
    };
    const ciServices = ci.jobs?.["test"]?.services ?? {};
    for (const svcName of ["postgres", "valkey", "nats"]) {
      const composeImage = compose.services?.[svcName]?.image;
      const ciImage = ciServices[svcName]?.image;
      if (!composeImage || !ciImage || composeImage !== ciImage) {
        violations.push({
          file: ".github/workflows/ci.yml",
          rule: "docker-image-parity",
          message: `Расхождение версии образа "${svcName}": docker-compose.yml="${composeImage ?? "none"}", ci.yml="${ciImage ?? "none"}".`,
        });
      }
    }
  }

  return violations;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const rootDir = resolve(import.meta.dirname, "..");
  const violations = validateCiIntegrity(rootDir);

  if (violations.length > 0) {
    process.stderr.write(`Нарушения целостности CI (${violations.length}):\n`);
    for (const v of violations) {
      process.stderr.write(`  - [${v.rule}] ${v.file}: ${v.message}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    "Целостность CI подтверждена: SHA-пиннинг, permissions, ruleset и паритет Docker-образов в норме.\n",
  );
}
