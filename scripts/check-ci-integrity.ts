import { globSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

interface Step {
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Job {
  name?: string;
  if?: string;
  needs?: string | string[];
  steps?: Step[];
  services?: Record<string, { image: string; options?: string }>;
}
interface Workflow {
  on?: Record<string, unknown>;
  permissions?: unknown;
  concurrency?: { 'cancel-in-progress'?: unknown };
  jobs: Record<string, Job>;
}
interface Rule {
  type: string;
  parameters?: {
    required_approving_review_count?: number;
    strict_required_status_checks_policy?: boolean;
    required_status_checks?: { context: string }[];
  };
}
interface Ruleset {
  enforcement: string;
  conditions: { ref_name: { include: string[] } };
  rules: Rule[];
}

const GATE = 'ci-required';
const STAGES = ['lint', 'typecheck', 'test', 'build', 'quality-gates'];
const RETENTION = "${{ github.ref == 'refs/heads/main' && 30 || 14 }}";

/** Внешние `uses:` — полный SHA и комментарий с версией. */
export function checkPins(file: string, text: string): string[] {
  return text.split('\n').flatMap((line, index) => {
    const value = /^\s*(?:-\s+)?["']?uses["']?:\s*(.+)$/.exec(line)?.[1]?.trim();
    if (!value || value.startsWith('./')) return [];
    return /^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(value)
      ? []
      : [`${file}:${index + 1}: нужен 40-символьный SHA с комментарием версии: ${value}`];
  });
}

export function checkWorkflow(file: string, text: string): string[] {
  const { permissions, on = {}, jobs } = parse(text) as Workflow;
  const errors: string[] = [];
  if (JSON.stringify(permissions) !== '{"contents":"read"}') {
    errors.push(`${file}: нужно permissions: { contents: read } на верхнем уровне`);
  }
  if ('pull_request_target' in on) {
    errors.push(`${file}: pull_request_target даёт форкам секреты и запись`);
  }
  for (const [name, job] of Object.entries(jobs)) {
    for (const { uses, if: condition, with: args } of job.steps ?? []) {
      if (!uses?.startsWith('actions/upload-artifact@')) continue;
      if (condition !== 'always()') errors.push(`${file}: ${name}: артефакт без if: always()`);
      if (args?.['retention-days'] !== RETENTION) {
        errors.push(`${file}: ${name}: срок хранения артефакта не 14/30 дней`);
      }
    }
  }
  return errors;
}

export function checkImages(file: string, text: string, compose: string): string[] {
  const local = (parse(compose) as { services: Record<string, { image: string }> }).services;
  return Object.entries((parse(text) as Workflow).jobs).flatMap(([job, { services = {} }]) =>
    Object.entries(services).flatMap(([name, { image, options = '' }]) => [
      ...(local[name]?.image === image
        ? []
        : [`${file}: ${job}: ${name} ${image} ≠ docker-compose ${local[name]?.image ?? '—'}`]),
      ...(options.includes('--health-cmd') ? [] : [`${file}: ${job}: ${name} без healthcheck`]),
    ]),
  );
}

export function checkGate(text: string, rulesetText: string): string[] {
  const { jobs } = parse(text) as Workflow;
  const { enforcement, conditions, rules } = JSON.parse(rulesetText) as Ruleset;
  const errors: string[] = [];
  const need = (ok: boolean | undefined, message: string): void => {
    if (!ok) errors.push(message);
  };
  const rule = (type: string): Rule | undefined => rules.find((r) => r.type === type);
  const contexts = rule('required_status_checks')?.parameters?.required_status_checks ?? [];
  const gate = jobs[GATE];
  need(
    contexts.length === 1 &&
      contexts[0]?.context === GATE &&
      (gate?.name ?? GATE) === GATE &&
      gate !== undefined,
    `ruleset и ci.yml расходятся: ожидается единственная проверка ${GATE}`,
  );
  need(gate?.if === 'always()', `${GATE}: нужно if: always()`);
  const needs = [gate?.needs ?? []].flat();
  const step = gate?.steps?.find((s) => s.run);
  for (const stage of STAGES) {
    need(jobs[stage] !== undefined, `ci.yml: нет стадии ${stage}`);
    need(needs.includes(stage), `${GATE}: нет ${stage} в needs`);
    const variable = stage.toUpperCase().replace('-', '_');
    need(
      step?.env?.[variable] === `\${{ needs.${stage}.result }}` &&
        step.run?.includes(`"$${variable}"`),
      `${GATE}: не проверяется результат ${stage}`,
    );
  }
  need(step?.run?.includes('!= success'), `${GATE}: нет сравнения с success`);
  need(enforcement === 'active', 'ruleset не активен');
  need(conditions.ref_name.include.includes('refs/heads/main'), 'ruleset не защищает main');
  for (const type of ['deletion', 'non_fast_forward', 'required_linear_history']) {
    need(rule(type) !== undefined, `ruleset: нет правила ${type}`);
  }
  const reviews = rule('pull_request')?.parameters?.required_approving_review_count ?? 0;
  need(reviews >= 1, 'ruleset: нужно минимум 1 одобрение');
  need(
    rule('required_status_checks')?.parameters?.strict_required_status_checks_policy,
    'ruleset: нужна актуальность ветки',
  );
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = (file: string): string => readFileSync(file, 'utf8');
  const compose = read('docker-compose.yml');
  const workflows = globSync('.github/workflows/*.{yml,yaml}');
  const actions = globSync('.github/actions/**/*.{yml,yaml}');
  const errors = [
    ...[...workflows, ...actions].flatMap((file) => checkPins(file, read(file))),
    ...workflows.flatMap((file) => [
      ...checkWorkflow(file, read(file)),
      ...checkImages(file, read(file), compose),
    ]),
    ...checkGate(read('.github/workflows/ci.yml'), read('.github/rulesets/main.json')),
  ];
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exitCode = 1;
  else console.log(`CI: проверено файлов ${workflows.length + actions.length}`);
}
