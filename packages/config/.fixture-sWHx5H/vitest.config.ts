const c = {
  provider: 'v8',
  reporter: ['text', 'json', 'lcov'],
  include: ['src/**/*.{ts,tsx}'],
  exclude: [
    '**/dist/**',
    '**/*.d.ts',
    '**/*.test.{ts,tsx}',
    '**/*.test-helper.ts',
    'packages/test-kit/**',
  ],
  thresholds: { lines: 85, statements: 85, branches: 80 },
};
export default {
  test: { include: ['*.test.ts'], coverage: { ...c, reporter: ['text'], include: ['a.ts'] } },
};
