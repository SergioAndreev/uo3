import type { Linter } from 'eslint';
import { COMMONJS_SELECTORS } from './base.js';

const message = 'Недетерминированный API в чистом ядре: используйте GameClock или SeededRng.';

/** Детерминизм `packages/domain` и `packages/rules`: время и случайность только через зависимости. */
const config: Linter.Config[] = [
  {
    rules: {
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'process', 'globalThis', 'performance'].map((name) => ({
          name,
          message,
        })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message },
        { object: 'Date', property: 'now', message },
        { object: 'performance', property: 'now', message },
      ],
      'no-restricted-syntax': [
        'error',
        ...COMMONJS_SELECTORS,
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message },
        { selector: "CallExpression[callee.name='Date']", message },
      ],
    },
  },
];

export default config;
