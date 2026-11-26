import { PACKAGE_ID as formats } from '@duskmarch/asset-formats';
import { AssetToolEnvSchema, loadServerConfigOrExit } from '@duskmarch/config/env/server';
import {
  UsageError,
  fingerprint,
  generateWorld,
  inspectChunk,
  query,
  radar,
  validatePack,
  type CommandResult,
} from './commands.js';

export const VERSION = '0.0.0';

export const HELP = [
  'Команды asset-tool:',
  '  validate-pack <каталог>                       проверить пакет ассетов',
  '  inspect-chunk <файл.dmck>                     сводка чанка мира',
  '  generate-world --preset proving|field --seed <n> --out <каталог> [--force]',
  '  radar <каталог> --out <файл.png>              превью плана',
  '  fingerprint <каталог>                         отпечаток пакета',
  '  query <каталог> --at x,y [--to x,y]          опоры, потолок и линия видимости',
  '  check-env                                     проверить окружение',
  '  --version, --help',
  'Флаг --json выводит один JSON-объект.',
].join('\n');

interface Parsed {
  positional: string[];
  options: Map<string, string | true>;
}

function parse(args: readonly string[]): Parsed {
  const positional: string[] = [];
  const options = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (!arg.startsWith('--')) positional.push(arg);
    else if (['--json', '--force', '--help', '--version'].includes(arg)) options.set(arg, true);
    else {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--'))
        throw new UsageError(`${arg}: нет значения`);
      options.set(arg, value);
      i++;
    }
  }
  return { positional, options };
}

const need = (value: string | true | undefined, name: string): string => {
  if (typeof value !== 'string' || value === '') throw new UsageError(`нужен аргумент ${name}`);
  return value;
};

/** Коды: 0 — успех, 1 — ошибки данных, 2 — ошибка вызова. */
export async function runCli(args: readonly string[], log = console.log): Promise<number> {
  let json = args.includes('--json');
  try {
    const { positional, options } = parse(args);
    json = options.has('--json');
    const [command, target] = positional;
    if (options.has('--version')) {
      log(`asset-tool ${VERSION} (${formats})`);
      return 0;
    }
    if (options.has('--help')) {
      log(HELP);
      return 0;
    }
    let result: CommandResult;
    switch (command) {
      case 'check-env':
        loadServerConfigOrExit(AssetToolEnvSchema);
        log('Конфигурация корректна');
        return 0;
      case 'validate-pack':
        result = await validatePack(need(target, '<каталог>'));
        break;
      case 'inspect-chunk':
        result = inspectChunk(need(target, '<файл>'));
        break;
      case 'generate-world':
        result = generateWorld(
          need(options.get('--preset'), '--preset'),
          Number(options.get('--seed') ?? 42),
          need(options.get('--out'), '--out'),
          options.has('--force'),
        );
        break;
      case 'radar':
        result = radar(need(target, '<каталог>'), need(options.get('--out'), '--out'));
        break;
      case 'query': {
        const to = options.get('--to');
        result = query(
          need(target, '<каталог>'),
          need(options.get('--at'), '--at'),
          typeof to === 'string' ? to : undefined,
        );
        break;
      }
      case 'fingerprint':
        result = fingerprint(need(target, '<каталог>'));
        break;
      default:
        throw new UsageError(command ? `неизвестная команда ${command}` : 'не указана команда');
    }
    log(json ? JSON.stringify({ ok: result.ok, ...result.data }) : result.lines.join('\n'));
    return result.ok ? 0 : 1;
  } catch (error) {
    if (!(error instanceof UsageError)) {
      const message = error instanceof Error ? error.message : String(error);
      log(json ? JSON.stringify({ ok: false, error: message }) : `Ошибка: ${message}`);
      return 1;
    }
    log(json ? JSON.stringify({ ok: false, usage: error.message }) : `${error.message}\n${HELP}`);
    return 2;
  }
}
