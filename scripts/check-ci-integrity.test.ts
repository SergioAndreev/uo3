import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { expect, it } from 'vitest';
import { checkGate, checkImages, checkPins, checkWorkflow } from './check-ci-integrity.js';

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const ruleset = readFileSync('.github/rulesets/main.json', 'utf8');
const compose = readFileSync('docker-compose.yml', 'utf8');
const sha = 'a'.repeat(40);

it('текущий CI целостен', () => {
  expect(checkPins('ci', ci)).toEqual([]);
  expect(checkWorkflow('ci', ci)).toEqual([]);
  expect(checkImages('ci', ci, compose)).toEqual([]);
  expect(checkGate(ci, ruleset)).toEqual([]);
});

it.each(['actions/checkout@v4', 'actions/checkout@main', `a/b@${sha}`, `a/b@${sha} # main`])(
  'отклоняет %s',
  (uses) => expect(checkPins('ci', `  - uses: ${uses}`)).toHaveLength(1),
);

it('принимает SHA с версией и локальное действие', () => {
  expect(checkPins('ci', `- uses: a/b/c@${sha} # v1.2.3\n- uses: ./x`)).toEqual([]);
});

it.each([
  ['contents: read', 'contents: write'],
  ['  pull_request:', '  pull_request_target:'],
  ['if: always()\n        uses: actions/upload', 'uses: actions/upload'],
  ['&& 30 || 14', '&& 90 || 90'],
])('workflow: замена %j обнаруживается', (from, to) => {
  expect(checkWorkflow('ci', ci.replace(from, to))).not.toEqual([]);
});

it('обнаруживает расхождение образов и отсутствие healthcheck', () => {
  expect(checkImages('ci', ci.replace('postgres:17.2', 'postgres:17.1'), compose)).toHaveLength(1);
  expect(checkImages('ci', ci.replace('--health-cmd', '--x'), compose)).toHaveLength(1);
});

it.each([
  ['  ci-required:\n    name: ci-required', '  gate:\n    name: gate'],
  ['name: ci-required', 'name: Gate'],
  [', build, quality-gates]', ', quality-gates]'],
  ['needs.test.result', 'needs.lint.result'],
  ['!= success', '= failure'],
])('ci-required: замена %j обнаруживается', (from, to) => {
  expect(checkGate(ci.replace(from, to), ruleset)).not.toEqual([]);
});

it.each([
  ['"ci-required"', '"other"'],
  ['"non_fast_forward"', '"x"'],
  ['"deletion"', '"x"'],
  ['"required_linear_history"', '"x"'],
  ['count": 1', 'count": 0'],
  ['checks_policy": true', 'checks_policy": false'],
  ['refs/heads/main', 'refs/heads/dev'],
  ['"active"', '"disabled"'],
])('ruleset: замена %j обнаруживается', (from, to) => {
  expect(checkGate(ci, ruleset.replace(from, to))).not.toEqual([]);
});

const stages = ['LINT', 'TYPECHECK', 'TEST', 'BUILD', 'QUALITY_GATES'];
const script = (parse(ci) as { jobs: Record<string, { steps: { run: string }[] }> }).jobs[
  'ci-required'
]?.steps[0]?.run;
const gate = (results: Record<string, string>): number => {
  try {
    execFileSync('bash', ['-e', '-c', script ?? 'exit 9'], {
      env: { ...process.env, ...results },
      stdio: 'ignore',
    });
    return 0;
  } catch (error) {
    return (error as { status: number }).status;
  }
};
const all = Object.fromEntries(stages.map((s) => [s, 'success']));

it('ci-required успешен, только если успешны все стадии', () => {
  expect(gate(all)).toBe(0);
});

it.each(stages.flatMap((s) => ['failure', 'cancelled', 'skipped', ''].map((r) => [s, r])))(
  'ci-required: %s = %j — отказ',
  (stage, result) => expect(gate({ ...all, [stage ?? '']: result ?? '' })).toBe(1),
);
