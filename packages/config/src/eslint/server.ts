import type { Linter } from 'eslint';

const config: Linter.Config[] = [
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@duskmarch/ui-kit', '@duskmarch/ui-kit/*', 'react', 'react-dom', 'three'],
              message: 'server -> browser-ui: запрещённый переход.',
            },
          ],
        },
      ],
    },
  },
];

export default config;
