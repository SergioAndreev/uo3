import { mergeConfig } from 'vitest/config';
import { nodePreset } from '@duskmarch/config/vitest/node';

// CLI-обёртки проверяются интеграционным тестом.
export default mergeConfig(nodePreset('default'), {
  test: { coverage: { exclude: ['src/cli/**'] } },
});
