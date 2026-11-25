export type CoverageTier = 'core' | 'default';

export function coverageThresholds(tier: CoverageTier) {
  return tier === 'core'
    ? { lines: 85, statements: 85, branches: 80 }
    : { lines: 70, statements: 70, branches: 65 };
}
