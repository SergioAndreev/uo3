import type { TObject, TProperties } from "@sinclair/typebox";
import {
  ConfigErrorCode,
  getSchemaProperties,
  isSecretProperty,
  type ConfigIssue,
} from "../shared/index.js";

const PLACEHOLDER_PATTERNS: readonly RegExp[] = [/CHANGE_ME_/i, /^dev-secret$/i, /^local-only$/i];

const MIN_PROD_SECRET_BYTES = 32;

export function isDevPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function checkProductionGuards<T extends TProperties>(
  schema: TObject<T>,
  config: Record<string, unknown>,
): ConfigIssue[] {
  if (config["NODE_ENV"] !== "production") {
    return [];
  }

  const props = getSchemaProperties(schema);
  const issues: ConfigIssue[] = [];

  for (const [key, propSchema] of Object.entries(props)) {
    const value = config[key];
    if (typeof value !== "string") {
      continue;
    }

    if (isDevPlaceholder(value)) {
      issues.push({
        code: ConfigErrorCode.CONFIG_INSECURE_PROD_VALUE,
        key,
        message: "Обнаружена локальная заглушка разработки в режиме production.",
        expected: "безопасное production-значение (без CHANGE_ME_ / dev-secret / local-only)",
      });
      continue;
    }

    if (isSecretProperty(propSchema)) {
      const byteLength = Buffer.byteLength(value, "utf8");
      if (byteLength < MIN_PROD_SECRET_BYTES) {
        issues.push({
          code: ConfigErrorCode.CONFIG_INSECURE_PROD_VALUE,
          key,
          message: `Длина секретного ключа в production меньше минимально допустимых ${MIN_PROD_SECRET_BYTES} байт.`,
          expected: `>= ${MIN_PROD_SECRET_BYTES} байт`,
        });
      }
    }
  }

  const corsOrigins = config["CORS_ALLOWED_ORIGINS"];
  const corsCredentials = config["CORS_ALLOW_CREDENTIALS"];
  if (corsCredentials === true && typeof corsOrigins === "string") {
    const origins = corsOrigins
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (origins.includes("*")) {
      issues.push({
        code: ConfigErrorCode.CONFIG_INSECURE_PROD_VALUE,
        key: "CORS_ALLOWED_ORIGINS",
        message:
          'Недопустимая комбинация CORS_ALLOWED_ORIGINS="*" при CORS_ALLOW_CREDENTIALS=true в production.',
        expected: "явный список доверенных origin без wildcard *",
      });
    }
  }

  return issues;
}
