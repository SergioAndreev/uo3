import {
  ConfigErrorCode,
  type ConfigIssue,
  type EnvSchema,
  type FieldMeta,
} from '../shared/index.js';

const MIN_KEY_BYTES = 32;

function passwordOf(value: string): string {
  try {
    return decodeURIComponent(new URL(value).password);
  } catch {
    return '';
  }
}

const isPlaceholder = (value: string): boolean =>
  value.startsWith('CHANGE_ME_') || value === 'dev-secret' || value === 'local-only';

/** Инварианты production. Сообщения не содержат значений. */
export function checkProductionInvariants(
  schema: EnvSchema,
  config: Readonly<Record<string, unknown>>,
): ConfigIssue[] {
  if (config['NODE_ENV'] !== 'production') return [];
  const issues: ConfigIssue[] = [];
  const add = (key: string, message: string): void => {
    issues.push({ code: ConfigErrorCode.INSECURE_PROD_VALUE, key, message });
  };
  for (const [key, field] of Object.entries(schema.properties)) {
    const value = config[key];
    if (typeof value !== 'string') continue;
    const meta = field as FieldMeta;
    if (isPlaceholder(value) || isPlaceholder(passwordOf(value))) {
      add(key, 'заглушка разработки запрещена в production');
    } else if (meta['x-crypto-key'] === true && Buffer.byteLength(value) < MIN_KEY_BYTES) {
      add(key, `длина ключа меньше ${MIN_KEY_BYTES} байт`);
    }
  }
  const origins = config['CORS_ALLOWED_ORIGINS'];
  if (
    Array.isArray(origins) &&
    origins.includes('*') &&
    config['CORS_ALLOW_CREDENTIALS'] === true
  ) {
    add('CORS_ALLOWED_ORIGINS', '* недопустим вместе с CORS_ALLOW_CREDENTIALS=true');
  }
  return issues;
}
