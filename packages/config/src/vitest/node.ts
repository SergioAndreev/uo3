import type { ViteUserConfig } from 'vitest/config';
import { coverageThresholds, type CoverageTier } from './thresholds.js';

export function nodePreset(tier: CoverageTier = 'default'): ViteUserConfig {
  return {
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      exclude: ['**/*.integration.test.ts', '**/node_modules/**', '**/dist/**'],
      testTimeout: 60_000,
      reporters: ['default', 'junit', 'json'],
      outputFile: { junit: 'reports/junit.xml', json: 'reports/vitest.json' },
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'lcov'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['**/dist/**', '**/*.d.ts', '**/*.test.{ts,tsx}', 'packages/test-kit/**'],
        thresholds: coverageThresholds(tier),
      },
    },
  };
}
