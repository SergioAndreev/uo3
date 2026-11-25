import { readFileSync } from 'node:fs';
import { Value } from '@sinclair/typebox/value';
import { expect, it } from 'vitest';
import { checkLicenses, type LicensePolicy } from './check-licenses.js';
import { LicensePolicySchema } from './lib/schemas.js';

const policy = JSON.parse(
  readFileSync('config/security/licenses.policy.json', 'utf8'),
) as LicensePolicy;
const pkg = (license: string, name = 'x') => ({ name, versions: ['1.0.0'], license });

it('политика соответствует схеме', () => {
  expect(Value.Check(LicensePolicySchema, policy)).toBe(true);
});

it.each(['MIT', '(MIT OR GPL-3.0)', 'MIT AND ISC'])('пропускает %s', (license) => {
  expect(checkLicenses([pkg(license)], policy)).toEqual([]);
});

it.each(['AGPL-3.0-only', 'UNKNOWN', 'MIT AND GPL-3.0', 'Custom'])('блокирует %s', (license) => {
  expect(checkLicenses([pkg(license)], policy)).toHaveLength(1);
});

it('исключение действует на пакет и лицензию', () => {
  expect(checkLicenses([pkg('CC-BY-4.0', 'caniuse-lite')], policy)).toEqual([]);
  expect(checkLicenses([pkg('CC-BY-4.0', 'other')], policy)).toHaveLength(1);
  expect(checkLicenses([pkg('GPL-3.0', 'caniuse-lite')], policy)).toHaveLength(1);
});
