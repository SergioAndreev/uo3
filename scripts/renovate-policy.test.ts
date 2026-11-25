import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

interface Rule {
  groupName?: string | null;
  matchUpdateTypes: string[];
  labels?: string[];
}
const config = JSON.parse(readFileSync('renovate.json', 'utf8')) as {
  extends: string[];
  minimumReleaseAge: string;
  prConcurrentLimit: number;
  vulnerabilityAlerts: { enabled: boolean; minimumReleaseAge: string | null };
  packageRules: Rule[];
};

it('соблюдает политику обновлений', () => {
  expect(Number.parseInt(config.minimumReleaseAge, 10)).toBeGreaterThanOrEqual(3);
  expect(config.prConcurrentLimit).toBeLessThanOrEqual(5);
  expect(config.extends).toContain('helpers:pinGitHubActionDigests');
  expect(config.extends).toContain('docker:pinDigests');
  expect(config.vulnerabilityAlerts).toMatchObject({ enabled: true, minimumReleaseAge: null });
  const groups = config.packageRules.map((rule) => rule.groupName).filter(Boolean);
  expect(groups).toEqual(['tooling', 'server', 'client', 'docker', 'github-actions']);
  const major = config.packageRules.find((rule) => rule.matchUpdateTypes.includes('major'));
  expect(major?.labels).toEqual(['breaking-update']);
});
