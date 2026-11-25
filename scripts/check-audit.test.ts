import { readFileSync } from 'node:fs';
import { Value } from '@sinclair/typebox/value';
import { expect, it } from 'vitest';
import { checkAudit } from './check-audit.js';
import { AuditWaiversSchema } from './lib/schemas.js';

const now = new Date('2026-06-15T12:00:00Z');
const advisory = (severity = 'high') => ({
  github_advisory_id: 'GHSA-x',
  module_name: 'm',
  severity,
  patched_versions: '>=2',
});
const waiver = (createdAt: string, expiresAt: string, name = 'm') => ({
  waivers: [
    {
      advisoryId: 'GHSA-x',
      package: name,
      reason: 'тестовая причина',
      owner: 'o',
      createdAt,
      expiresAt,
    },
  ],
});

it('файл исключений валиден', () => {
  const raw: unknown = JSON.parse(readFileSync('config/security/audit-waivers.json', 'utf8'));
  expect(Value.Check(AuditWaiversSchema, raw)).toBe(true);
});

it('без уязвимостей и ниже high — чисто', () => {
  expect(checkAudit([], { waivers: [] }, now)).toEqual([]);
  expect(checkAudit([advisory('moderate')], { waivers: [] }, now)).toEqual([]);
});

it('действующее исключение покрывает только свой пакет', () => {
  expect(checkAudit([advisory()], waiver('2026-06-01', '2026-06-15'), now)).toEqual([]);
  expect(checkAudit([advisory()], waiver('2026-06-01', '2026-06-30', 'other'), now)).toHaveLength(
    1,
  );
  expect(checkAudit([advisory('critical')], { waivers: [] }, now)).toHaveLength(1);
});

it.each([
  ['2026-05-20', '2026-06-14', 'истекло'],
  ['2026-06-01', '2026-07-02', 'срок'],
  ['2026-06-20', '2026-06-25', 'будущем'],
  ['2026-99-99', '2026-06-25', 'срок'],
])('отклоняет %s..%s: %s', (from, to, reason) => {
  const errors = checkAudit([advisory()], waiver(from, to), now);
  expect(errors.join()).toContain(reason);
  expect(errors).toHaveLength(2);
});
