import type { Linter } from 'eslint';

const config: Linter.Config[] = [
  {
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', '@duskmarch/db', '@duskmarch/db/*', '@duskmarch/config/env/server'],
              message: 'browser -> server: серверный модуль запрещён в браузере.',
            },
          ],
        },
      ],
    },
  },
];

export default config;
