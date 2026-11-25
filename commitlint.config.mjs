const MODULES = [
  ...['client', 'api', 'game-server', 'admin', 'asset-tool', 'bot-client'],
  ...['domain', 'rules', 'protocol', 'asset-formats', 'content', 'db', 'ui-kit', 'config'],
  'test-kit',
];
const PHASES = Array.from({ length: 37 }, (_, i) => `p${String(i).padStart(2, '0')}`);

export default {
  extends: ['@commitlint/config-conventional'],
  ignores: [(message) => /^Revert "/.test(message)],
  rules: {
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0],
    // Заголовки на русском: правила регистра английского языка неприменимы.
    'subject-case': [0],
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    'scope-enum': [2, 'always', [...MODULES, 'repo', 'ci', 'infra', 'deps', 'release', ...PHASES]],
  },
};
