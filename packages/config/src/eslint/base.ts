import js from '@eslint/js';
import type { Linter } from 'eslint';
import tseslint from 'typescript-eslint';

const config: Linter.Config[] = [
  js.configs.recommended,
  ...(tseslint.configs.recommended as Linter.Config[]),
  {
    rules: {
      // Неиспользуемые и неопределённые имена в TypeScript проверяет компилятор.
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='module'][property.name='exports']",
          message: 'CommonJS запрещён: используйте export.',
        },
        {
          selector: "CallExpression[callee.name='require']",
          message: 'CommonJS запрещён: используйте import.',
        },
      ],
    },
  },
];

export default config;
