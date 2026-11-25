import { Type, type SchemaOptions, type TObject, type TProperties } from '@sinclair/typebox';

export const PROTOCOLS = {
  http: ['http', 'https'],
  ws: ['ws', 'wss'],
  postgres: ['postgres', 'postgresql'],
  redis: ['redis', 'rediss'],
  nats: ['nats', 'tls'],
} as const;

/** Метаданные полей, понятные загрузчикам. */
export interface FieldMeta extends SchemaOptions {
  'x-secret'?: boolean;
  'x-sensitive-uri'?: boolean;
  'x-crypto-key'?: boolean;
  'x-protocols'?: readonly string[];
}

export type EnvSchema = TObject<TProperties>;

export const Port = (options: FieldMeta = {}) =>
  Type.Integer({ minimum: 1, maximum: 65535, ...options });
export const TimeoutMs = (options: FieldMeta = {}) => Type.Integer({ minimum: 1, ...options });
export const Flag = (options: FieldMeta = {}) => Type.Boolean(options);
export const Text = (options: FieldMeta = {}) => Type.String({ minLength: 1, ...options });
export const CsvList = (options: FieldMeta = {}) =>
  Type.Array(Type.String({ minLength: 1 }), options);
export const Url = (kind: keyof typeof PROTOCOLS, options: FieldMeta = {}) =>
  Type.String({ 'x-protocols': PROTOCOLS[kind], ...options });
export const createSecretSchema = (options: FieldMeta = {}) =>
  Type.String({ minLength: 1, 'x-secret': true, ...options });
export const createSensitiveUriSchema = (kind: keyof typeof PROTOCOLS, options: FieldMeta = {}) =>
  Url(kind, { 'x-sensitive-uri': true, ...options });
export const LogLevel = (options: FieldMeta = {}) =>
  Type.Union(
    (['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const).map((v) => Type.Literal(v)),
    { default: 'info', ...options },
  );
export const AppEnv = (options: FieldMeta = {}) =>
  Type.Union(
    (['development', 'test', 'staging', 'production'] as const).map((v) => Type.Literal(v)),
    { default: 'development', ...options },
  );

/** Целое в десятичной записи без пробелов и экспонент; иначе `undefined`. */
export function parseStrictInt(raw: string): number | undefined {
  if (!/^-?\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

export function parseStrictBoolean(raw: string): boolean | undefined {
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
}

export function isUrlWithProtocol(raw: string, protocols: readonly string[]): boolean {
  try {
    const url = new URL(raw);
    return protocols.includes(url.protocol.slice(0, -1)) && url.hostname !== '';
  } catch {
    return false;
  }
}

export const isSecret = (field: FieldMeta): boolean =>
  field['x-secret'] === true || field['x-sensitive-uri'] === true;
