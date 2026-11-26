import js from '@eslint/js';
import type { Linter } from 'eslint';
import tseslint from 'typescript-eslint';

/** Запрет CommonJS; переиспользуется пресетами, которые расширяют `no-restricted-syntax`. */
export const COMMONJS_SELECTORS = [
  {
    selector: "MemberExpression[object.name='module'][property.name='exports']",
    message: 'CommonJS запрещён: используйте export.',
  },
  {
    selector: "CallExpression[callee.name='require']",
    message: 'CommonJS запрещён: используйте import.',
  },
];

const config: Linter.Config[] = [
  js.configs.recommended,
  ...(tseslint.configs.recommended as Linter.Config[]),
  {
    rules: {
      // Неиспользуемые и неопределённые имена в TypeScript проверяет компилятор.
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      'no-restricted-syntax': ['error', ...COMMONJS_SELECTORS],
    },
  },
];

export default config;
