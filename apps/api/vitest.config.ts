import { mergeConfig } from 'vitest/config';
import { nodePreset } from '@duskmarch/config/vitest/node';

// main.ts проверяется запуском дочернего процесса.
export default mergeConfig(nodePreset('default'), {
  test: {
    coverage: {
      // CLI и адаптеры PostgreSQL/Valkey/NATS проверяются в test:integration.
      exclude: ['src/main.ts', 'src/cli/**', 'src/identity/infra/**', '**/*.test-helper.ts'],
    },
  },
});
