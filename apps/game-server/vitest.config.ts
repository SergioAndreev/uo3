import { mergeConfig } from 'vitest/config';
import { nodePreset } from '@duskmarch/config/vitest/node';

// main.ts — запуском дочернего процесса; комнаты Colyseus, адаптеры инфраструктуры и загрузка шарда —
// интеграционным тестом runtime.integration.test.ts.
export default mergeConfig(nodePreset('default'), {
  test: {
    coverage: {
      exclude: ['src/main.ts', 'src/rooms/**', 'src/host/infra-ports.ts', 'src/host/boot.ts'],
    },
  },
});
