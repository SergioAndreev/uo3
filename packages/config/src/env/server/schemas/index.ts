import { Type } from '@sinclair/typebox';
import {
  AppEnv,
  CsvList,
  Flag,
  LogLevel,
  Port,
  Text,
  TimeoutMs,
  Url,
  createSecretSchema,
  createSensitiveUriSchema,
} from '../../shared/index.js';

const runtime = {
  NODE_ENV: AppEnv({ description: 'Среда выполнения' }),
  LOG_LEVEL: LogLevel({ description: 'Уровень логирования' }),
};
export const DatabaseEnvSchema = Type.Object({
  DATABASE_URL: createSensitiveUriSchema('postgres', { description: 'Подключение к PostgreSQL' }),
});
export const ValkeyEnvSchema = Type.Object({
  VALKEY_URL: createSensitiveUriSchema('redis', { description: 'Подключение к Valkey' }),
  VALKEY_PASSWORD: Type.Optional(createSecretSchema({ description: 'Пароль Valkey' })),
});
export const NatsEnvSchema = Type.Object({
  NATS_URL: createSensitiveUriSchema('nats', { description: 'Подключение к NATS' }),
  NATS_PASSWORD: Type.Optional(createSecretSchema({ description: 'Пароль NATS' })),
});
export const TelemetryEnvSchema = Type.Object({
  OTEL_EXPORTER_OTLP_ENDPOINT: Type.Optional(Url('http', { description: 'Адрес OTLP-коллектора' })),
});
const infra = {
  ...runtime,
  ...DatabaseEnvSchema.properties,
  ...ValkeyEnvSchema.properties,
  ...NatsEnvSchema.properties,
  ...TelemetryEnvSchema.properties,
  SHUTDOWN_TIMEOUT_MS: TimeoutMs({ default: 15_000, description: 'Предел плавной остановки, мс' }),
};

export const DbEnvSchema = Type.Object({
  ...runtime,
  ...DatabaseEnvSchema.properties,
  DATABASE_TEST_URL: Type.Optional(
    createSensitiveUriSchema('postgres', { description: 'База интеграционных тестов' }),
  ),
});

export const ApiEnvSchema = Type.Object({
  ...infra,
  API_HOST: Text({ default: '127.0.0.1', description: 'Адрес HTTP API' }),
  API_PORT: Port({ default: 3001, description: 'Порт HTTP API' }),
  IDENTITY_JWT_SIGNING_KEYS_JSON: Type.Optional(
    createSecretSchema({ 'x-crypto-key': true, description: 'Ключи Ed25519 (формат задаёт P04)' }),
  ),
  CORS_ALLOWED_ORIGINS: CsvList({
    default: ['http://localhost:5273'],
    description: 'Разрешённые origin через запятую',
  }),
  CORS_ALLOW_CREDENTIALS: Flag({ default: true, description: 'Разрешить cookie в CORS' }),
  ENABLE_SWAGGER: Flag({ default: false, description: 'Публиковать OpenAPI UI' }),
});

export const GameServerEnvSchema = Type.Object({
  ...infra,
  GAME_HOST: Text({ default: '127.0.0.1', description: 'Адрес игрового сервера' }),
  GAME_PORT: Port({ default: 2567, description: 'Порт WebSocket' }),
  GAME_HEALTH_PORT: Port({ default: 2568, description: 'Порт проверок здоровья' }),
  SHARD_ID: Text({
    default: 'local-dev',
    pattern: '^[a-z0-9-]+$',
    description: 'Идентификатор шарда',
  }),
  SHARD_RULESET_PRESET: Type.Union([Type.Literal('standard'), Type.Literal('proving')], {
    default: 'standard',
    description: 'Пресет профиля правил шарда',
  }),
  SHARD_RULESET_FILE: Type.Optional(
    Text({ description: 'Файл переопределения правил шарда (JSON или YAML)' }),
  ),
});

export const AssetToolEnvSchema = Type.Object({
  ...runtime,
  ASSETS_INPUT_DIR: Type.Optional(Text({ description: 'Каталог исходных ассетов' })),
  SYNTHETIC_OUTPUT_DIR: Text({
    default: './local-assets',
    description: 'Каталог синтетического мира',
  }),
});

export const BotClientEnvSchema = Type.Object({
  ...runtime,
  TARGET_API_URL: Url('http', { description: 'Адрес API' }),
  TARGET_GAME_WS_URL: Url('ws', { description: 'Адрес игрового сервера' }),
  BOT_CONCURRENCY: Type.Integer({
    minimum: 1,
    maximum: 5000,
    default: 1,
    description: 'Число ботов',
  }),
});

const port = (value: number, description: string) => Port({ default: value, description });

/** Корневой `.env`: параметры Docker Compose и команд `db:*`. */
export const WorkspaceEnvSchema = Type.Object({
  PG_USER: Text({ default: 'duskmarch', description: 'Пользователь PostgreSQL' }),
  PG_PASSWORD: createSecretSchema({ description: 'Пароль PostgreSQL' }),
  PG_PORT: port(5432, 'Порт PostgreSQL'),
  VALKEY_PORT: port(6379, 'Порт Valkey'),
  NATS_PORT: port(4222, 'Порт NATS'),
  NATS_MONITOR_PORT: port(8222, 'Порт мониторинга NATS'),
  OTEL_GRPC_PORT: port(4317, 'Порт OTLP gRPC'),
  OTEL_HTTP_PORT: port(4318, 'Порт OTLP HTTP'),
  PROMETHEUS_PORT: port(9090, 'Порт Prometheus'),
  LOKI_PORT: port(3100, 'Порт Loki'),
  TEMPO_PORT: port(3200, 'Порт Tempo'),
  GRAFANA_PORT: port(3000, 'Порт Grafana'),
  DATABASE_URL: DbEnvSchema.properties.DATABASE_URL,
  DATABASE_TEST_URL: DbEnvSchema.properties.DATABASE_TEST_URL,
});
