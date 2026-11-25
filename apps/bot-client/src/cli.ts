import { BotClientEnvSchema, loadServerConfigOrExit } from '@duskmarch/config/env/server';
import { PACKAGE_ID as protocol } from '@duskmarch/protocol';

export const VERSION = '0.0.0';
const TIMEOUT_MS = 3_000;

export async function pingHealth(apiUrl: string): Promise<boolean> {
  try {
    const url = new URL('/healthz', apiUrl);
    return (await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })).ok;
  } catch {
    return false;
  }
}

export async function runCli(args: readonly string[], log = console.log): Promise<number> {
  switch (args[0]) {
    case '--version':
      log(`bot-client ${VERSION} (${protocol})`);
      return 0;
    case 'ping-health': {
      const config = loadServerConfigOrExit(BotClientEnvSchema);
      const ok = await pingHealth(config.TARGET_API_URL);
      log(`${config.TARGET_API_URL}: ${ok ? 'доступен' : 'недоступен'}`);
      return ok ? 0 : 1;
    }
    default:
      log('Команды: --version, ping-health');
      return 1;
  }
}
