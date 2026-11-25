import { PACKAGE_ID as formats } from '@duskmarch/asset-formats';
import { AssetToolEnvSchema, loadServerConfigOrExit } from '@duskmarch/config/env/server';

export const VERSION = '0.0.0';

export async function runCli(args: readonly string[], log = console.log): Promise<number> {
  switch (args[0]) {
    case '--version':
      log(`asset-tool ${VERSION} (${formats})`);
      return 0;
    case 'check-env':
      loadServerConfigOrExit(AssetToolEnvSchema);
      log('Конфигурация корректна');
      return 0;
    default:
      log('Команды: --version, check-env');
      return 1;
  }
}
