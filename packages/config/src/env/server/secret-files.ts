import { readFileSync } from "node:fs";
import type { TObject, TProperties } from "@sinclair/typebox";
import {
  ConfigErrorCode,
  getSchemaProperties,
  isSecretProperty,
  isSensitiveUriProperty,
  type ConfigIssue,
} from "../shared/index.js";

export interface SecretFileResolution {
  readonly values: Record<string, string>;
  readonly issues: readonly ConfigIssue[];
}

function hasValue(map: Record<string, string | undefined>, key: string): boolean {
  const val = map[key];
  return typeof val === "string" && val.length > 0;
}

export function resolveSecretFiles<T extends TProperties>(
  schema: TObject<T>,
  processEnv: Record<string, string | undefined>,
  dotEnv: Record<string, string> = {},
): SecretFileResolution {
  const props = getSchemaProperties(schema);
  const values: Record<string, string> = {};
  const issues: ConfigIssue[] = [];

  for (const [key, propSchema] of Object.entries(props)) {
    if (!isSecretProperty(propSchema) && !isSensitiveUriProperty(propSchema)) {
      continue;
    }

    const fileKey = `${key}_FILE`;
    const inProcVal = hasValue(processEnv, key);
    const inProcFile = hasValue(processEnv, fileKey);
    const inDotVal = hasValue(dotEnv, key);
    const inDotFile = hasValue(dotEnv, fileKey);

    if (inProcVal && inProcFile) {
      issues.push({
        code: ConfigErrorCode.CONFIG_CONFLICT,
        key,
        message: `Одновременно заданы ${key} и ${fileKey}; укажите только один источник.`,
      });
      continue;
    }

    if (!inProcVal && !inProcFile && inDotVal && inDotFile) {
      issues.push({
        code: ConfigErrorCode.CONFIG_CONFLICT,
        key,
        message: `Одновременно заданы ${key} и ${fileKey} в .env-файлах; укажите только один источник.`,
      });
      continue;
    }

    if (inProcVal) {
      continue;
    }

    const filePath = inProcFile ? processEnv[fileKey] : inDotFile ? dotEnv[fileKey] : undefined;
    if (filePath === undefined) {
      continue;
    }

    try {
      const rawContent = readFileSync(filePath, "utf8");
      const stripped = rawContent.replace(/[\r\n]+$/, "");
      if (stripped.trim().length === 0) {
        issues.push({
          code: ConfigErrorCode.CONFIG_SECRET_FILE_ERROR,
          key: fileKey,
          message: `Файл секрета для ${key} пуст.`,
        });
        continue;
      }
      values[key] = stripped;
    } catch {
      issues.push({
        code: ConfigErrorCode.CONFIG_SECRET_FILE_ERROR,
        key: fileKey,
        message: `Файл секрета для ${key} не существует или недоступен для чтения.`,
      });
    }
  }

  return { values, issues };
}
