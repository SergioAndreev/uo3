import type { TObject, TProperties } from "@sinclair/typebox";
import { getSchemaProperties, isSecretProperty, isSensitiveUriProperty } from "./primitives.js";

export const REDACTED_VALUE = "[REDACTED]" as const;
export const REDACTED_INVALID_URI = "[REDACTED_INVALID_URI]" as const;

export function redactUri(rawUri: string): string {
  try {
    const parsed = new URL(rawUri);
    if (!parsed.password) {
      return rawUri;
    }
    const userPart = parsed.username
      ? `${parsed.username}:${REDACTED_VALUE}@`
      : `:${REDACTED_VALUE}@`;
    const hostPart = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
    return `${parsed.protocol}//${userPart}${hostPart}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return REDACTED_INVALID_URI;
  }
}

export function redactConfig<T extends TProperties>(
  schema: TObject<T>,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const props = getSchemaProperties(schema);
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    const propSchema = props[key];
    if (value === undefined) {
      continue;
    }
    if (propSchema && isSecretProperty(propSchema)) {
      result[key] = REDACTED_VALUE;
      continue;
    }
    if (propSchema && isSensitiveUriProperty(propSchema)) {
      result[key] = typeof value === "string" ? redactUri(value) : REDACTED_INVALID_URI;
      continue;
    }
    result[key] = value;
  }

  return result;
}
