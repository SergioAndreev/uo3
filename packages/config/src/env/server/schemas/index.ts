import { Type, type Static } from "@sinclair/typebox";
import {
  createSecretSchema,
  HttpUrlSchema,
  LogLevelSchema,
  NatsUrlSchema,
  NodeEnvSchema,
  PositiveTimeoutMsSchema,
  PostgresUrlSchema,
  RedisUrlSchema,
  TcpPortSchema,
  WsUrlSchema,
} from "../../shared/index.js";

export const RootInfraEnvSchema = Type.Object(
  {
    NODE_ENV: NodeEnvSchema("development"),
    PG_USER: Type.String({
      minLength: 1,
      default: "uo3",
      description: "Пользователь локальной БД PostgreSQL",
    }),
    PG_PASSWORD: createSecretSchema({
      default: "CHANGE_ME_LOCAL_DEV_ONLY",
      description: "Пароль локальной БД PostgreSQL",
    }),
    PG_PORT: TcpPortSchema(5432, "Хостовый порт PostgreSQL 17"),
    VALKEY_PORT: TcpPortSchema(6379, "Хостовый порт Valkey 8"),
    NATS_PORT: TcpPortSchema(4222, "Клиентский хостовый порт NATS JetStream"),
    NATS_MONITOR_PORT: TcpPortSchema(8222, "HTTP-порт мониторинга NATS"),
    OTEL_GRPC_PORT: TcpPortSchema(4317, "Порт OTLP gRPC OpenTelemetry Collector"),
    OTEL_HTTP_PORT: TcpPortSchema(4318, "Порт OTLP HTTP OpenTelemetry Collector"),
    PROMETHEUS_PORT: TcpPortSchema(9090, "Хостовый порт Prometheus"),
    LOKI_PORT: TcpPortSchema(3100, "Хостовый порт Loki"),
    TEMPO_PORT: TcpPortSchema(3200, "Хостовый порт Tempo"),
    GRAFANA_PORT: TcpPortSchema(3000, "Хостовый порт Grafana"),
    DATABASE_URL: PostgresUrlSchema({ description: "Строка подключения к БД разработки uo3_dev" }),
    TEST_DATABASE_URL: PostgresUrlSchema({
      description: "Строка подключения к изолированной тестовой БД uo3_test",
    }),
    VALKEY_URL: RedisUrlSchema({ description: "Строка подключения к Valkey 8" }),
    NATS_URL: NatsUrlSchema({ description: "Строка подключения к NATS JetStream" }),
  },
  { additionalProperties: false },
);
export type RootInfraEnv = Static<typeof RootInfraEnvSchema>;

export const DbEnvSchema = Type.Object(
  {
    NODE_ENV: NodeEnvSchema("development"),
    DATABASE_URL: PostgresUrlSchema({
      description: "Строка подключения к основной БД PostgreSQL 17",
    }),
    TEST_DATABASE_URL: Type.Optional(
      PostgresUrlSchema({ description: "Строка подключения к изолированной тестовой БД uo3_test" }),
    ),
    DB_POOL_MAX: Type.Integer({
      minimum: 1,
      maximum: 200,
      default: 10,
      description: "Максимальный размер пула подключений PostgreSQL",
    }),
    DB_HEALTH_TIMEOUT_MS: PositiveTimeoutMsSchema(500, "Таймаут проверки здоровья БД (мс)"),
  },
  { additionalProperties: false },
);
export type DbEnv = Static<typeof DbEnvSchema>;

export const ApiEnvSchema = Type.Object(
  {
    NODE_ENV: NodeEnvSchema("development"),
    LOG_LEVEL: LogLevelSchema("info"),
    API_HOST: Type.String({
      minLength: 1,
      default: "0.0.0.0",
      description: "Сетевой интерфейс прослушивания API",
    }),
    API_PORT: TcpPortSchema(3001, "TCP-порт HTTP сервера apps/api"),
    DATABASE_URL: PostgresUrlSchema({ description: "Строка подключения к PostgreSQL 17" }),
    VALKEY_URL: RedisUrlSchema({ description: "Строка подключения к Valkey 8" }),
    NATS_URL: NatsUrlSchema({ description: "Строка подключения к NATS JetStream" }),
    IDENTITY_JWT_SIGNING_KEYS_JSON: Type.Optional(
      createSecretSchema({
        description: "JSON-набор ключей подписи EdDSA JWT (ADR-009; обязательность задаёт P04)",
      }),
    ),
    CORS_ALLOWED_ORIGINS: Type.String({
      minLength: 1,
      default: "http://localhost:5173,http://localhost:5174",
      description: "Список разрешённых CORS origins через запятую",
    }),
    CORS_ALLOW_CREDENTIALS: Type.Boolean({
      default: true,
      description: "Разрешение передачи cookies/credentials в CORS",
    }),
    ENABLE_SWAGGER: Type.Boolean({
      default: false,
      description: "Включение OpenAPI/Swagger UI",
    }),
    SHUTDOWN_TIMEOUT_MS: PositiveTimeoutMsSchema(15000, "Таймаут graceful shutdown (мс)"),
    OTEL_EXPORTER_OTLP_ENDPOINT: Type.Optional(
      HttpUrlSchema({ description: "HTTP-эндпоинт OpenTelemetry OTLP exporter" }),
    ),
  },
  { additionalProperties: false },
);
export type ApiEnv = Static<typeof ApiEnvSchema>;

export const GameServerEnvSchema = Type.Object(
  {
    NODE_ENV: NodeEnvSchema("development"),
    LOG_LEVEL: LogLevelSchema("info"),
    GAME_HOST: Type.String({
      minLength: 1,
      default: "0.0.0.0",
      description: "Сетевой интерфейс Colyseus/HTTP",
    }),
    GAME_PORT: TcpPortSchema(2567, "TCP-порт Colyseus WebSocket игрового сервера"),
    GAME_HEALTH_PORT: TcpPortSchema(2568, "HTTP-порт эндпоинтов /healthz и /readyz"),
    DATABASE_URL: PostgresUrlSchema({ description: "Строка подключения к PostgreSQL 17" }),
    VALKEY_URL: RedisUrlSchema({ description: "Строка подключения к Valkey 8" }),
    NATS_URL: NatsUrlSchema({ description: "Строка подключения к NATS JetStream" }),
    SHARD_ID: Type.String({
      minLength: 1,
      default: "local-dev",
      description: "Идентификатор шарда",
    }),
    SHARD_RULESET_PRESET: Type.String({
      minLength: 1,
      default: "uor",
      description: "Базовый пресет правил эпохи шарда (uor, uor-felucca-only, uor-dev-fast)",
    }),
    SHARD_RULESET_FILE: Type.Optional(
      Type.String({
        description: "Путь к YAML-файлу переопределений правил шарда (shard-ruleset.yaml)",
      }),
    ),
    SHUTDOWN_TIMEOUT_MS: PositiveTimeoutMsSchema(15000, "Таймаут graceful shutdown (мс)"),
    OTEL_EXPORTER_OTLP_ENDPOINT: Type.Optional(
      HttpUrlSchema({ description: "HTTP-эндпоинт OpenTelemetry OTLP exporter" }),
    ),
  },
  { additionalProperties: false },
);
export type GameServerEnv = Static<typeof GameServerEnvSchema>;

export const AssetToolEnvSchema = Type.Object(
  {
    NODE_ENV: NodeEnvSchema("development"),
    LOG_LEVEL: LogLevelSchema("info"),
    UO_ASSETS_INPUT_DIR: Type.Optional(
      Type.String({ minLength: 1, description: "Локальный путь к клиентским файлам UO (BYOC)" }),
    ),
    SYNTHETIC_OUTPUT_DIR: Type.String({
      minLength: 1,
      default: "./local-assets/synthetic",
      description: "Каталог вывода сгенерированного синтетического мира",
    }),
  },
  { additionalProperties: false },
);
export type AssetToolEnv = Static<typeof AssetToolEnvSchema>;

export const BotClientEnvSchema = Type.Object(
  {
    NODE_ENV: NodeEnvSchema("development"),
    LOG_LEVEL: LogLevelSchema("info"),
    TARGET_API_URL: HttpUrlSchema({ description: "Базовый HTTP URL целевого apps/api" }),
    TARGET_GAME_WS_URL: WsUrlSchema({ description: "WebSocket URL целевого apps/game-server" }),
    BOT_CONCURRENCY: Type.Integer({
      minimum: 1,
      maximum: 5000,
      default: 10,
      description: "Количество одновременных headless-ботов (1..5000)",
    }),
  },
  { additionalProperties: false },
);
export type BotClientEnv = Static<typeof BotClientEnvSchema>;
