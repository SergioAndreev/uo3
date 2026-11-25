import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { LicensePolicySchema } from './lib/schemas.js';

export type LicensePolicy = Static<typeof LicensePolicySchema>;
export interface LicensedPackage {
  name: string;
  versions: string[];
  license: string;
}

/** `A OR B` допустимо при одном разрешённом варианте, `A AND B` — при всех. */
export function isAllowed(expression: string, policy: LicensePolicy): boolean {
  const clean = expression.replace(/[()]/g, '').trim();
  if (clean.includes(' OR ')) return clean.split(' OR ').some((part) => isAllowed(part, policy));
  return clean.split(' AND ').every((part) => policy.allowedSpdx.includes(part.trim()));
}

export function checkLicenses(
  packages: readonly LicensedPackage[],
  policy: LicensePolicy,
): LicensedPackage[] {
  return packages.filter((item) => {
    if (isAllowed(item.license, policy)) return false;
    return !policy.exceptions.some((e) => e.package === item.name && e.license === item.license);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw: unknown = JSON.parse(readFileSync('config/security/licenses.policy.json', 'utf8'));
  if (!Value.Check(LicensePolicySchema, raw))
    throw new Error('licenses.policy.json: неверная схема');
  const pnpm = (args: string[]): string =>
    execFileSync('pnpm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const tree = JSON.parse(pnpm(['licenses', 'list', '--json'])) as Record<
    string,
    LicensedPackage[]
  >;
  const packages = Object.entries(tree).flatMap(([license, list]) =>
    list.map((item) => ({ ...item, license })),
  );
  const violations = checkLicenses(packages, raw);
  for (const { name, versions, license } of violations) {
    const denied = raw.deniedPatterns.some((p) => license.toUpperCase().includes(p));
    console.error(`${name}@${versions.join()}: ${license}${denied ? ' (запрещена)' : ''}`);
    console.error(pnpm(['why', '-r', name]));
  }
  if (violations.length > 0) process.exitCode = 1;
  else console.log(`Лицензии: проверено пакетов ${packages.length}`);
}
