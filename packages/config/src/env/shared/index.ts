export const ENV_SHARED_MODULE_ID = "@uo3/config/env/shared" as const;

export {
  CONFIG_EXIT_CODE,
  ConfigError,
  ConfigErrorCode,
  formatConfigDiagnosticReport,
  type ConfigIssue,
} from "./errors.js";

export {
  createSecretSchema,
  createSensitiveUriSchema,
  getSchemaProperties,
  HttpUrlSchema,
  isSecretProperty,
  isSensitiveUriProperty,
  isValidUrlWithProtocols,
  LOG_LEVELS,
  LogLevelSchema,
  NatsUrlSchema,
  NODE_ENVS,
  NodeEnvSchema,
  parseStrictBoolean,
  parseStrictInt,
  PositiveTimeoutMsSchema,
  PostgresUrlSchema,
  RedisUrlSchema,
  registerConfigFormats,
  TcpPortSchema,
  WsUrlSchema,
  type LogLevel,
  type NodeEnv,
} from "./primitives.js";

export { deepFreeze, type DeepReadonly } from "./deep-freeze.js";

export { redactConfig, REDACTED_INVALID_URI, REDACTED_VALUE, redactUri } from "./redact.js";
