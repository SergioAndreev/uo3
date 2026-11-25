import type { ESLint, Linter } from 'eslint';
import boundariesModule from 'eslint-plugin-boundaries';

// Плагин — CommonJS с `default`; форма экспорта под NodeNext не совпадает с типами.
const loaded = boundariesModule as unknown as ESLint.Plugin & { default?: ESLint.Plugin };
const boundaries: ESLint.Plugin = loaded.default ?? loaded;

/** Разрешённые runtime-зависимости каждого модуля (design P00, матрица зависимостей). */
export const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  config: [],
  domain: [],
  rules: ['domain'],
  protocol: ['domain'],
  'asset-formats': ['domain'],
  content: ['domain', 'rules'],
  db: ['domain', 'config'],
  'ui-kit': ['domain', 'protocol', 'config'],
  'test-kit': ['domain', 'rules', 'protocol', 'asset-formats', 'content', 'config'],
  client: ['domain', 'rules', 'protocol', 'asset-formats', 'content', 'ui-kit', 'config'],
  admin: ['domain', 'protocol', 'content', 'ui-kit', 'config'],
  api: ['domain', 'rules', 'protocol', 'content', 'db', 'config'],
  'game-server': ['domain', 'rules', 'protocol', 'asset-formats', 'content', 'db', 'config'],
  'asset-tool': ['domain', 'asset-formats', 'content', 'config'],
  'bot-client': ['domain', 'rules', 'protocol', 'config'],
};

const APPS = new Set(['client', 'admin', 'api', 'game-server', 'asset-tool', 'bot-client']);

const config: Linter.Config[] = [
  {
    files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.boundaries.json' } },
      'boundaries/elements': Object.keys(ALLOWED).map((name) => ({
        type: name,
        pattern: `${APPS.has(name) ? 'apps' : 'packages'}/${name}`,
      })),
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: Object.entries(ALLOWED).map(([from, allow]) => ({
            from,
            allow: [from, ...allow],
          })),
        },
      ],
    },
  },
];

export default config;
