import type { ViteUserConfig } from 'vitest/config';
import { nodePreset } from './node.js';
import type { CoverageTier } from './thresholds.js';

export function browserPreset(tier: CoverageTier = 'default'): ViteUserConfig {
  const preset = nodePreset(tier);
  return { ...preset, test: { ...preset.test, environment: 'jsdom' } };
}
