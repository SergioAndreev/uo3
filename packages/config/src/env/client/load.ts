import type { Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  ConfigError,
  ConfigErrorCode,
  deepFreeze,
  isSecret,
  resolveFields,
  type EnvSchema,
  type FieldMeta,
} from '../shared/index.js';

/** Отклоняет схемы с ключами без `VITE_` и с секретами. */
export function assertClientSchemaSafe(schema: EnvSchema): void {
  const issues = Object.entries(schema.properties)
    .filter(([key, field]) => !key.startsWith('VITE_') || isSecret(field as FieldMeta))
    .map(([key]) => ({
      code: ConfigErrorCode.CLIENT_SECRET_FORBIDDEN,
      key,
      message: 'клиенту доступны только публичные переменные VITE_*',
    }));
  if (issues.length > 0) throw new ConfigError(issues);
}

/** Value.Check не генерирует код, поэтому совместим с CSP без eval (ADR-012). */
export function loadClientConfig<T extends EnvSchema>(
  schema: T,
  env: Readonly<Record<string, unknown>>,
): Readonly<Static<T>> {
  assertClientSchemaSafe(schema);
  const raw = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  const { config, issues } = resolveFields(schema, raw, (field, value) =>
    Value.Check(field, value),
  );
  if (issues.length > 0) throw new ConfigError(issues);
  return deepFreeze(config) as Readonly<Static<T>>;
}
