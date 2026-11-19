import type { Static, TObject, TProperties, TSchema } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
  ConfigError,
  ConfigErrorCode,
  deepFreeze,
  getSchemaProperties,
  isSecretProperty,
  isSensitiveUriProperty,
  parseStrictBoolean,
  parseStrictInt,
  type ConfigIssue,
  type DeepReadonly,
} from "../shared/index.js";
import { loadDotEnvFiles } from "./dotenv.js";
import { checkProductionGuards } from "./prod-guards.js";
import { resolveSecretFiles } from "./secret-files.js";

export interface LoadServerConfigOptions {
  readonly env?: Record<string, string | undefined>;
  readonly cwd?: string;
  readonly appName?: string;
  readonly loadDotEnv?: boolean;
}

function getExpectedHint(propSchema: TSchema): string {
  const meta = propSchema as Record<string, unknown>;
  if (typeof meta["description"] === "string" && meta["description"].length > 0) {
    return meta["description"];
  }
  if (typeof meta["format"] === "string") {
    return `формат ${meta["format"]}`;
  }
  if (typeof meta["type"] === "string") {
    return meta["type"];
  }
  return "валидное значение по схеме";
}

function coerceFieldValue(
  key: string,
  raw: string,
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
          expected: getExpectedHint(propSchema),
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
          expected: "true | false | 1 | 0",
        },
      };
    }
    return { ok: true, value: parsed };
  }

  return { ok: true, value: raw };
}

export function loadServerConfig<T extends TProperties>(
  schema: TObject<T>,
  options: LoadServerConfigOptions = {},
): DeepReadonly<Static<TObject<T>>> {
  const processEnv = options.env ?? process.env;
  const appName = options.appName ?? "uo3-server";
  const effectiveNodeEnv = processEnv["NODE_ENV"] ?? "development";

  const dotEnv =
    options.loadDotEnv === false
      ? {}
      : loadDotEnvFiles(effectiveNodeEnv, options.cwd ?? process.cwd());

  const { values: fileSecrets, issues: fileIssues } = resolveSecretFiles(
    schema,
    processEnv,
    dotEnv,
  );

  const mergedRaw: Record<string, string | undefined> = {
    ...dotEnv,
    ...fileSecrets,
  };
  for (const [k, v] of Object.entries(processEnv)) {
    if (v !== undefined) {
      mergedRaw[k] = v;
    }
  }

  const issues: ConfigIssue[] = [...fileIssues];
  const erroredKeys = new Set(fileIssues.map((i) => i.key.replace(/_FILE$/, "")));

  const props = getSchemaProperties(schema);
  const requiredSet = new Set(schema.required ?? []);
  const candidate: Record<string, unknown> = {};

  for (const [key, propSchema] of Object.entries(props)) {
    if (erroredKeys.has(key)) {
      continue;
    }

    const raw = mergedRaw[key];
    const hasDefault = "default" in (propSchema as Record<string, unknown>);
    const defaultValue = (propSchema as Record<string, unknown>)["default"];

    if (raw === undefined || raw === "") {
      if (hasDefault) {
        candidate[key] = defaultValue;
      } else if (requiredSet.has(key)) {
        issues.push({
          code: ConfigErrorCode.CONFIG_VALIDATION_FAILED,
          key,
          message: "Обязательная переменная окружения не задана.",
          expected: getExpectedHint(propSchema),
        });
        erroredKeys.add(key);
      }
      continue;
    }

    const coerced = coerceFieldValue(key, raw, propSchema);
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
    const propSchema = props[key];
    const isSensitive =
      propSchema !== undefined &&
      (isSecretProperty(propSchema) || isSensitiveUriProperty(propSchema));

    issues.push({
      code: ConfigErrorCode.CONFIG_VALIDATION_FAILED,
      key,
      message: isSensitive
        ? "Значение не соответствует требуемому формату или ограничениям схемы."
        : error.message,
      expected: propSchema ? getExpectedHint(propSchema) : "валидное значение",
    });
    erroredKeys.add(key);
  }

  const prodIssues = checkProductionGuards(schema, candidate);
  issues.push(...prodIssues);

  if (issues.length > 0) {
    throw new ConfigError(issues, appName);
  }

  return deepFreeze(candidate) as DeepReadonly<Static<TObject<T>>>;
}

export function loadServerConfigOrExit<T extends TProperties>(
  schema: TObject<T>,
  options: LoadServerConfigOptions = {},
  onExit: (code: number) => never = (code) => process.exit(code),
): DeepReadonly<Static<TObject<T>>> {
  try {
    return loadServerConfig(schema, options);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.formatReport()}\n`);
      return onExit(err.exitCode);
    }
    throw err;
  }
}
