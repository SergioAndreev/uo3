import type { Static, TObject, TProperties, TSchema } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
  ConfigError,
  ConfigErrorCode,
  deepFreeze,
  getSchemaProperties,
  isSecretProperty,
  parseStrictBoolean,
  parseStrictInt,
  type ConfigIssue,
  type DeepReadonly,
} from "../shared/index.js";

export const CLIENT_ENV_PREFIX = "VITE_" as const;

export function assertClientSchemaSafe<T extends TProperties>(
  schema: TObject<T>,
  appName = "uo3-client",
): void {
  const props = getSchemaProperties(schema);
  const issues: ConfigIssue[] = [];

  for (const [key, propSchema] of Object.entries(props)) {
    if (!key.startsWith(CLIENT_ENV_PREFIX)) {
      issues.push({
        code: ConfigErrorCode.CONFIG_CLIENT_SECRET_FORBIDDEN,
        key,
        message: `Клиентская схема допускает только публичные переменные с префиксом ${CLIENT_ENV_PREFIX}.`,
        expected: `ключ с префиксом ${CLIENT_ENV_PREFIX}`,
      });
    }
    if (isSecretProperty(propSchema)) {
      issues.push({
        code: ConfigErrorCode.CONFIG_CLIENT_SECRET_FORBIDDEN,
        key,
        message: "Поля с аннотацией x-secret запрещены в браузерной клиентской схеме.",
        expected: "только публичные несекретные переменные",
      });
    }
  }

  if (issues.length > 0) {
    throw new ConfigError(issues, appName);
  }
}

function coerceClientField(
  key: string,
  raw: unknown,
  propSchema: TSchema,
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly issue: ConfigIssue } {
  const schemaType = (propSchema as Record<string, unknown>)["type"];

  if (schemaType === "integer" || schemaType === "number") {
    const parsed = parseStrictInt(raw);
    if (parsed === undefined) {
      return {
        ok: false,
        issue: {
          code: ConfigErrorCode.CONFIG_VALIDATION_FAILED,
          key,
          message: "Некорректное целое число.",
        },
      };
    }
    return { ok: true, value: parsed };
  }

  if (schemaType === "boolean") {
    const parsed = parseStrictBoolean(raw);
    if (parsed === undefined) {
      return {
        ok: false,
        issue: {
          code: ConfigErrorCode.CONFIG_VALIDATION_FAILED,
          key,
          message: "Некорректное булево значение (допускаются только true, false, 1, 0).",
        },
      };
    }
    return { ok: true, value: parsed };
  }

  return { ok: true, value: String(raw) };
}

export function loadClientConfig<T extends TProperties>(
  schema: TObject<T>,
  rawEnv: Record<string, unknown>,
  appName = "uo3-client",
): DeepReadonly<Static<TObject<T>>> {
  assertClientSchemaSafe(schema, appName);

  const props = getSchemaProperties(schema);
  const requiredSet = new Set(schema.required ?? []);
  const issues: ConfigIssue[] = [];
  const erroredKeys = new Set<string>();
  const candidate: Record<string, unknown> = {};

  for (const [key, propSchema] of Object.entries(props)) {
    const raw = rawEnv[key];
    const hasDefault = "default" in (propSchema as Record<string, unknown>);
    const defaultValue = (propSchema as Record<string, unknown>)["default"];

    if (raw === undefined || raw === "") {
      if (hasDefault) {
        candidate[key] = defaultValue;
      } else if (requiredSet.has(key)) {
        issues.push({
          code: ConfigErrorCode.CONFIG_VALIDATION_FAILED,
          key,
          message: "Обязательная клиентская переменная не задана.",
        });
        erroredKeys.add(key);
      }
      continue;
    }

    const coerced = coerceClientField(key, raw, propSchema);
    if (!coerced.ok) {
      issues.push(coerced.issue);
      erroredKeys.add(key);
      continue;
    }
    candidate[key] = coerced.value;
  }

  const compiled = TypeCompiler.Compile(schema);
  for (const error of compiled.Errors(candidate)) {
    const key = error.path.replace(/^\//, "").split("/")[0] || "config";
    if (erroredKeys.has(key)) {
      continue;
    }
    issues.push({
      code: ConfigErrorCode.CONFIG_VALIDATION_FAILED,
      key,
      message: error.message,
    });
    erroredKeys.add(key);
  }

  if (issues.length > 0) {
    throw new ConfigError(issues, appName);
  }

  return deepFreeze(candidate) as DeepReadonly<Static<TObject<T>>>;
}
