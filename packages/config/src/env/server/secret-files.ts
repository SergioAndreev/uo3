import { readFileSync } from 'node:fs';
import {
  ConfigErrorCode,
  isSecret,
  type ConfigIssue,
  type EnvSchema,
  type FieldMeta,
  type RawEnv,
} from '../shared/index.js';

const has = (env: RawEnv, key: string): boolean => env[key] !== undefined && env[key] !== '';

/**
 * Подставляет содержимое `<KEY>_FILE`. Значение процесса важнее файла, файл важнее `.env*`;
 * KEY и KEY_FILE, заданные в одном источнике, — конфликт.
 */
export function resolveSecretFiles(
  schema: EnvSchema,
  processEnv: RawEnv,
  dotEnv: RawEnv,
): { values: Record<string, string | undefined>; issues: ConfigIssue[] } {
  const values: Record<string, string | undefined> = { ...dotEnv };
  for (const key of Object.keys(processEnv))
    if (has(processEnv, key)) values[key] = processEnv[key];
  const issues: ConfigIssue[] = [];
  for (const [key, field] of Object.entries(schema.properties)) {
    if (!isSecret(field as FieldMeta)) continue;
    const fileKey = `${key}_FILE`;
    const conflict = [processEnv, dotEnv].some((env) => has(env, key) && has(env, fileKey));
    if (conflict) {
      issues.push({
        code: ConfigErrorCode.CONFLICT,
        key,
        message: `одновременно заданы ${key} и ${fileKey}`,
      });
      continue;
    }
    const path = values[fileKey];
    if (!path || has(processEnv, key)) continue;
    let content = '';
    try {
      content = readFileSync(path, 'utf8').replace(/[\r\n]+$/, '');
    } catch {
      // Причина сообщается ниже без содержимого файла.
    }
    if (content.trim() === '') {
      issues.push({
        code: ConfigErrorCode.SECRET_FILE_ERROR,
        key,
        message: `файл из ${fileKey} не существует, недоступен или пуст`,
      });
      continue;
    }
    values[key] = content;
  }
  return { values, issues };
}
