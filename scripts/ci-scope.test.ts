import { expect, it } from 'vitest';
import { computeScope, readDependencies } from './ci-scope.js';

const scope = (...files: string[]) => computeScope('abc', files, readDependencies());

it('листовое приложение проверяется отдельно', () => {
  expect(scope('apps/admin/src/main.tsx')).toEqual({
    full: false,
    filter: '--filter=...[abc]',
    paths: ['apps/admin'],
  });
});

it('изменение пакета затрагивает зависимых транзитивно', () => {
  const { paths } = scope('packages/ui-kit/src/index.ts');
  expect(paths).toEqual(['apps/admin', 'apps/client', 'packages/ui-kit']);
});

it('документация не затрагивает пакеты', () => {
  expect(scope('docs/CONCEPT.md', 'README.md')).toMatchObject({ full: false, paths: [] });
});

it.each([
  'tsconfig.base.json',
  'pnpm-lock.yaml',
  '.github/workflows/ci.yml',
  'packages/config/src/a.ts',
  'scripts/doctor.ts',
  'infra/local/nats/nats.conf',
])('%s требует полного прогона', (file) => {
  expect(scope('apps/admin/src/main.tsx', file)).toMatchObject({ full: true, filter: '' });
});

it('push в main — полный прогон', () => {
  expect(computeScope('', [], new Map())).toMatchObject({ full: true, paths: ['.'] });
});
