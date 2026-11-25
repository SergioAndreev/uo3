import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { AuditWaiversSchema } from './lib/schemas.js';

export type AuditWaivers = Static<typeof AuditWaiversSchema>;
export interface Advisory {
  github_advisory_id: string;
  module_name: string;
  severity: string;
  patched_versions: string;
}

const DAY_MS = 86_400_000;
const MAX_WAIVER_DAYS = 30;

export function checkAudit(
  advisories: readonly Advisory[],
  { waivers }: AuditWaivers,
  now: Date,
): string[] {
  const errors: string[] = [];
  const active = new Set<string>();
  for (const waiver of waivers) {
    const key = `${waiver.advisoryId} ${waiver.package}`;
    const from = Date.parse(waiver.createdAt);
    const until = Date.parse(waiver.expiresAt);
    const days = (until - from) / DAY_MS;
    if (!(days >= 0 && days <= MAX_WAIVER_DAYS)) {
      errors.push(`${key}: срок исключения должен быть 0..${MAX_WAIVER_DAYS} дней`);
    } else if (from > now.getTime()) errors.push(`${key}: исключение создано в будущем`);
    // Исключение действует до конца указанного дня.
    else if (until + DAY_MS <= now.getTime()) errors.push(`${key}: исключение истекло`);
    else active.add(key);
  }
  for (const advisory of advisories) {
    if (advisory.severity !== 'high' && advisory.severity !== 'critical') continue;
    const key = `${advisory.github_advisory_id} ${advisory.module_name}`;
    if (!active.has(key)) {
      errors.push(`${key}: ${advisory.severity}, исправлено в ${advisory.patched_versions}`);
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw: unknown = JSON.parse(readFileSync('config/security/audit-waivers.json', 'utf8'));
  if (!Value.Check(AuditWaiversSchema, raw)) throw new Error('audit-waivers.json: неверная схема');
  const run = spawnSync('pnpm', ['audit', '--prod', '--json'], { encoding: 'utf8' });
  const report = JSON.parse(run.stdout) as { advisories?: Record<string, Advisory> };
  // Ответ без advisories — ошибка реестра, а не отсутствие уязвимостей.
  if (!report.advisories) throw new Error('аудит не выполнен: реестр не вернул отчёт');
  const errors = checkAudit(Object.values(report.advisories), raw, new Date());
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exitCode = 1;
  else console.log('Аудит: непокрытых уязвимостей high/critical нет');
}
