import { mergeConfig } from 'vitest/config';
import { nodePreset } from '@duskmarch/config/vitest/node';

// index.ts проверяется запуском дочернего процесса.
export default mergeConfig(nodePreset('default'), {
  test: { coverage: { exclude: ['src/index.ts'] } },
});
