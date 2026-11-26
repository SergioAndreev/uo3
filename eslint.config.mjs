import base from '@duskmarch/config/eslint/base';
import boundaries from '@duskmarch/config/eslint/boundaries';
import browser from '@duskmarch/config/eslint/browser';
import pure from '@duskmarch/config/eslint/pure';
import server from '@duskmarch/config/eslint/server';

const scope = (configs, files) => configs.map((config) => ({ ...config, files }));

export default [
  { ignores: ['**/dist/**', '**/coverage/**', '**/reports/**', '**/.turbo/**', '.*/**'] },
  ...base,
  ...boundaries,
  ...scope(browser, ['apps/{client,admin}/src/**/*.{ts,tsx}', 'packages/ui-kit/src/**/*.{ts,tsx}']),
  ...scope(server, [
    'apps/{api,game-server,asset-tool,bot-client}/src/**/*.ts',
    'packages/db/src/**/*.ts',
    'scripts/**/*.ts',
  ]),
  ...scope(pure, ['packages/{domain,rules}/src/**/*.ts']).map((config) => ({
    ...config,
    ignores: ['packages/domain/src/runtime/system-clock.ts', '**/*.test.ts'],
  })),
];
