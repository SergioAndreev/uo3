import type { TSchema } from '@sinclair/typebox';
import { ConfigErrorCode, type ConfigIssue } from './errors.js';
import {
  isUrlWithProtocol,
  parseStrictBoolean,
  parseStrictInt,
  type EnvSchema,
  type FieldMeta,
} from './primitives.js';
import { redactUri } from './redact.js';

export type FieldCheck = (schema: TSchema, value: unknown) => boolean;
export type RawEnv = Readonly<Record<string, string | undefined>>;

function coerce(field: TSchema, raw: string): unknown {
  switch (field['type']) {
    case 'integer':
      return parseStrictInt(raw);
    case 'boolean':
      return parseStrictBoolean(raw);
    case 'array':
      return raw.split(',').map((item) => item.trim());
    default:
      return raw;
  }
}

function describe(field: TSchema): string {
  const meta = field as FieldMeta;
  if (meta['x-protocols']) return `URL со схемой ${meta['x-protocols'].join(' | ')}`;
  if (Array.isArray(field['anyOf'])) {
    return (field['anyOf'] as { const: string }[]).map((option) => option.const).join(' | ');
  }
  switch (field['type']) {
    case 'integer':
      return `целое ${String(field['minimum'] ?? '')}..${String(field['maximum'] ?? '')}`;
    case 'boolean':
      return 'true | false | 1 | 0';
    case 'array':
      return 'непустые значения через запятую';
    default:
      return field['pattern'] ? `строка по шаблону ${String(field['pattern'])}` : 'непустая строка';
  }
}

function shown(field: FieldMeta, raw: string): string {
  if (field['x-secret'] === true) return '[REDACTED]';
  return field['x-sensitive-uri'] === true ? redactUri(raw) : JSON.stringify(raw);
}

/** Приводит и проверяет все поля за один проход. Пустая строка означает «не задано». */
export function resolveFields(
  schema: EnvSchema,
  env: RawEnv,
  check: FieldCheck,
): { config: Record<string, unknown>; issues: ConfigIssue[] } {
  const config: Record<string, unknown> = {};
  const issues: ConfigIssue[] = [];
  const required = new Set(schema.required ?? []);
  for (const [key, field] of Object.entries(schema.properties)) {
    const raw = env[key];
    if (raw === undefined || raw === '') {
      if (field['default'] !== undefined) config[key] = structuredClone(field['default']);
      else if (required.has(key)) {
        issues.push({
          code: ConfigErrorCode.VALIDATION_FAILED,
          key,
          message: `обязательное значение не задано, ожидается ${describe(field)}`,
        });
      }
      continue;
    }
    const value = coerce(field, raw);
    const protocols = (field as FieldMeta)['x-protocols'];
    if (
      value === undefined ||
      !check(field, value) ||
      (protocols && !isUrlWithProtocol(raw, protocols))
    ) {
      issues.push({
        code: ConfigErrorCode.VALIDATION_FAILED,
        key,
        message: `недопустимое значение ${shown(field as FieldMeta, raw)}, ожидается ${describe(field)}`,
      });
      continue;
    }
    config[key] = value;
  }
  return { config, issues };
}
