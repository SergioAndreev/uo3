import {
  FormatRegistry,
  Type,
  type StringOptions,
  type TObject,
  type TProperties,
  type TSchema,
} from "@sinclair/typebox";

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const NODE_ENVS = ["development", "test", "staging", "production"] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export function isValidUrlWithProtocols(raw: string, allowedProtocols: readonly string[]): boolean {
  try {
    const parsed = new URL(raw);
    const proto = parsed.protocol.replace(/:$/, "").toLowerCase();
    return allowedProtocols.includes(proto) && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

let formatsRegistered = false;

export function registerConfigFormats(): void {
  if (formatsRegistered) {
    return;
  }
  FormatRegistry.Set("url-http", (v) => isValidUrlWithProtocols(v, ["http", "https"]));
  FormatRegistry.Set("url-ws", (v) => isValidUrlWithProtocols(v, ["ws", "wss"]));
  FormatRegistry.Set("url-postgres", (v) => isValidUrlWithProtocols(v, ["postgres", "postgresql"]));
  FormatRegistry.Set("url-redis", (v) => isValidUrlWithProtocols(v, ["redis", "rediss"]));
  FormatRegistry.Set("url-nats", (v) => isValidUrlWithProtocols(v, ["nats", "tls"]));
  formatsRegistered = true;
}

registerConfigFormats();

export function parseStrictBoolean(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "number") {
    if (raw === 1) return true;
    if (raw === 0) return false;
    return undefined;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === "true" || trimmed === "1") return true;
    if (trimmed === "false" || trimmed === "0") return false;
  }
  return undefined;
}

export function parseStrictInt(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) ? raw : undefined;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      return undefined;
    }
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function TcpPortSchema(defaultPort?: number, description = "TCP-порт (1..65535)") {
  return Type.Integer({
    minimum: 1,
    maximum: 65535,
    description,
    ...(defaultPort !== undefined ? { default: defaultPort } : {}),
  });
}

export function PositiveTimeoutMsSchema(
  defaultMs?: number,
  description = "Положительный таймаут в миллисекундах (> 0)",
) {
  return Type.Integer({
    minimum: 1,
    description,
    ...(defaultMs !== undefined ? { default: defaultMs } : {}),
  });
}

export const LogLevelSchema = (defaultLevel: LogLevel = "info") =>
  Type.Union(
    LOG_LEVELS.map((l) => Type.Literal(l)),
    {
      default: defaultLevel,
      description: `Уровень логирования (${LOG_LEVELS.join(" | ")})`,
    },
  );

export const NodeEnvSchema = (defaultEnv: NodeEnv = "development") =>
  Type.Union(
    NODE_ENVS.map((e) => Type.Literal(e)),
    {
      default: defaultEnv,
      description: `Профиль окружения (${NODE_ENVS.join(" | ")})`,
    },
  );

export function HttpUrlSchema(options: StringOptions = {}) {
  return Type.String({
    format: "url-http",
    minLength: 1,
    ...options,
  });
}

export function WsUrlSchema(options: StringOptions = {}) {
  return Type.String({
    format: "url-ws",
    minLength: 1,
    ...options,
  });
}

export function PostgresUrlSchema(options: StringOptions = {}) {
  return Type.String({
    format: "url-postgres",
    minLength: 1,
    "x-sensitive-uri": true,
    ...options,
  });
}

export function RedisUrlSchema(options: StringOptions = {}) {
  return Type.String({
    format: "url-redis",
    minLength: 1,
    "x-sensitive-uri": true,
    ...options,
  });
}

export function NatsUrlSchema(options: StringOptions = {}) {
  return Type.String({
    format: "url-nats",
    minLength: 1,
    "x-sensitive-uri": true,
    ...options,
  });
}

export function createSecretSchema(options: StringOptions = {}) {
  return Type.String({
    minLength: 1,
    "x-secret": true,
    ...options,
  });
}

export function createSensitiveUriSchema(
  format: "url-postgres" | "url-redis" | "url-nats" | "url-http" | "url-ws",
  options: StringOptions = {},
) {
  return Type.String({
    format,
    minLength: 1,
    "x-sensitive-uri": true,
    ...options,
  });
}

export function isSecretProperty(propSchema: TSchema): boolean {
  return (propSchema as Record<string, unknown>)["x-secret"] === true;
}

export function isSensitiveUriProperty(propSchema: TSchema): boolean {
  return (propSchema as Record<string, unknown>)["x-sensitive-uri"] === true;
}

export function getSchemaProperties<T extends TProperties>(
  schema: TObject<T>,
): Record<string, TSchema> {
  return schema.properties as Record<string, TSchema>;
}
