import { mergeConfig } from 'vitest/config';
import { nodePreset } from '@duskmarch/config/vitest/node';

// CLI-обёртки и модули Valkey (live/) проверяются интеграционными тестами.
export default mergeConfig(nodePreset('default'), {
  test: { coverage: { exclude: ['src/cli/**', 'src/live/**', 'src/world/**'] } },
});
