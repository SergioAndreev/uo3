import type { EnvSchema, FieldMeta } from './primitives.js';

const MASK = '[REDACTED]';

/** Маскирует пароль URI; для невалидного URI не возвращает ничего из исходной строки. */
export function redactUri(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return '[REDACTED_INVALID_URI]';
  }
  if (url.hostname === '') return '[REDACTED_INVALID_URI]';
  const credentials =
    url.password !== ''
      ? `${url.username}:${MASK}@`
      : url.username !== ''
        ? `${url.username}@`
        : '';
  // Параметры запроса отбрасываются: драйверы принимают в них пароли.
  return `${url.protocol}//${credentials}${url.host}${url.pathname}${url.search ? `?${MASK}` : ''}`;
}

export function redactValue(field: FieldMeta, value: unknown): unknown {
  if (value === undefined) return undefined;
  if (field['x-secret'] === true) return MASK;
  if (field['x-sensitive-uri'] === true) return redactUri(String(value));
  return value;
}

/** Представление конфигурации, безопасное для логов. Ключи вне схемы не выводятся. */
export function redactConfig(
  schema: EnvSchema,
  config: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(schema.properties)
      .filter(([key]) => config[key] !== undefined)
      .map(([key, field]) => [key, redactValue(field as FieldMeta, config[key])]),
  );
}
