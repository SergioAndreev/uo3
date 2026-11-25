import { mergeConfig } from 'vitest/config';
import { nodePreset } from '@duskmarch/config/vitest/node';

// main.ts проверяется запуском дочернего процесса.
export default mergeConfig(nodePreset('default'), {
  test: { coverage: { exclude: ['src/main.ts'] } },
});
