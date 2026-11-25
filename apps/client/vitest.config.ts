import { mergeConfig } from 'vitest/config';
import { browserPreset } from '@duskmarch/config/vitest/browser';

// main.tsx — точка входа; проверяется сборкой.
export default mergeConfig(browserPreset('default'), {
  test: { coverage: { exclude: ['src/main.tsx'] } },
});
