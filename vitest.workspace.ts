import { defineWorkspace } from 'vitest/config';

const roots = ['apps/*/src', 'packages/*/src', 'scripts', 'infra'];
const at = (suffix: string): string[] => roots.map((root) => `${root}/**/*${suffix}`);

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: [...at('.test.ts'), ...at('.test.tsx')],
      exclude: [...at('.integration.test.ts'), '**/node_modules/**'],
      testTimeout: 60_000,
    },
  },
  {
    test: { name: 'integration', include: at('.integration.test.ts') },
  },
]);
