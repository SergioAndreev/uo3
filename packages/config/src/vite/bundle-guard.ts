import type { Plugin } from 'vite';
import * as server from '../env/server/schemas/index.js';
import { isSecret, type EnvSchema, type FieldMeta } from '../env/shared/index.js';

/** Имена секретных переменных всех серверных схем. */
export const SECRET_KEYS: readonly string[] = [
  ...new Set(
    (Object.values(server) as EnvSchema[]).flatMap((schema) =>
      Object.entries(schema.properties)
        .filter(([, field]) => isSecret(field as FieldMeta))
        .map(([key]) => key),
    ),
  ),
];

/** Находит в коде бандла имена секретов, заглушки и приватные ключи. */
export function findLeaks(code: string, secretValues: readonly string[] = []): string[] {
  return [
    ...SECRET_KEYS.filter((key) => new RegExp(`\\b${key}\\b`).test(code)),
    ...(/CHANGE_ME_[A-Z_]+/.test(code) ? ['CHANGE_ME_*'] : []),
    ...(code.includes(['PRIVATE', 'KEY-----'].join(' ')) ? ['приватный ключ'] : []),
    // Значение не выводится, чтобы не попасть в лог.
    ...(secretValues.some((value) => code.includes(value)) ? ['значение секрета'] : []),
  ];
}

const MIN_SECRET_LENGTH = 8;

/** Прерывает сборку при утечке секрета или модуле Node.js и пишет bundle-stats.json. */
export function bundleGuard(env: NodeJS.ProcessEnv = process.env): Plugin {
  const secrets = SECRET_KEYS.map((key) => env[key] ?? '').filter(
    (value) => value.length >= MIN_SECRET_LENGTH,
  );
  return {
    name: 'duskmarch:bundle-guard',
    apply: 'build',
    // До встроенного плагина, который подменяет модули Node.js заглушкой.
    enforce: 'pre',
    resolveId(source) {
      if (source.startsWith('node:')) {
        this.error(`CONFIG_CLIENT_SECRET_FORBIDDEN: модуль ${source} недоступен в браузере`);
      }
      return null;
    },
    generateBundle(_, bundle) {
      const files = Object.values(bundle).map((item) => {
        const body = item.type === 'chunk' ? item.code : item.source;
        const text = typeof body === 'string' ? body : Buffer.from(body).toString('utf8');
        const leaks = findLeaks(text, secrets);
        if (leaks.length > 0) {
          this.error(`CONFIG_CLIENT_SECRET_FORBIDDEN: ${item.fileName}: ${leaks.join(', ')}`);
        }
        return { file: item.fileName, bytes: Buffer.byteLength(body) };
      });
      const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
      this.emitFile({
        type: 'asset',
        fileName: 'bundle-stats.json',
        source: JSON.stringify({ totalBytes, files }, null, 2),
      });
    },
  };
}
