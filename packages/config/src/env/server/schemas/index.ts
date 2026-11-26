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

const prodKey = (description: string) =>
  Type.Optional(
    createSecretSchema({ 'x-crypto-key': true, 'x-required-in-production': true, description }),
  );
const level = (values: readonly string[], fallback: string, description: string) =>
  Type.Union(
    values.map((v) => Type.Literal(v)),
    { default: fallback, description },
  );

/** Переменные подсистемы identity (P04). */
const IdentityEnvFields = {
  IDENTITY_JWT_SIGNING_KEYS_JSON: prodKey(
    'JSON-массив {kid, privateKeyPem, retiredAt?} ключей Ed25519; вне production без него ключ создаётся при старте',
  ),
  IDENTITY_JWT_ISSUER: Text({ default: 'duskmarch', description: 'Поле iss Access JWT' }),
  IDENTITY_JWT_AUDIENCE: Text({ default: 'duskmarch-api', description: 'Поле aud Access JWT' }),
  IDENTITY_TOTP_KEYS_JSON: prodKey(
    'JSON {версия: base64 32 байта} ключей AES-256-GCM секретов TOTP',
  ),
  IDENTITY_TOTP_KEY_VERSION: Text({ default: '1', description: 'Версия ключа TOTP для записи' }),
  IDENTITY_BACKUP_CODE_PEPPER: prodKey('Перец HMAC резервных кодов 2FA'),
  IDENTITY_PUBLIC_URL: Url('http', {
    default: 'http://localhost:5273',
    description: 'Адрес клиента для ссылок в письмах',
  }),
  IDENTITY_TRUSTED_ORIGINS: CsvList({
    default: ['http://localhost:5273', 'http://localhost:5274'],
    description: 'Origin, которым разрешены cookie-эндпоинты',
  }),
  IDENTITY_TOS_VERSION: Text({ default: '2026-11-01', description: 'Действующая версия условий' }),
  IDENTITY_PRIVACY_VERSION: Text({
    default: '2026-11-01',
    description: 'Действующая версия политики конфиденциальности',
  }),
  IDENTITY_BLOCKED_EMAIL_DOMAINS: CsvList({
    default: [],
    description: 'Запрещённые почтовые домены через запятую',
  }),
  IDENTITY_REGISTRATION_CHALLENGE: level(
    ['off', 'required'],
    'off',
    'Антибот-проверка регистрации; поставщик проверки подключается позже',
  ),
  IDENTITY_ARGON2_MEMORY_KIB: Type.Integer({
    minimum: 1024,
    default: 19_456,
    description: 'Память argon2id, КиБ',
  }),
  IDENTITY_ARGON2_TIME_COST: Type.Integer({
    minimum: 1,
    default: 2,
    description: 'Число проходов argon2id',
  }),
  MAIL_TRANSPORT: level(['log', 'smtp'], 'log', 'log — письма в журнал, smtp — отправка'),
  MAIL_SMTP_URL: Type.Optional(
    createSensitiveUriSchema('smtp', { description: 'Адрес SMTP-сервера' }),
  ),
  MAIL_FROM: Text({
    default: 'Duskmarch <no-reply@duskmarch.invalid>',
    description: 'Отправитель писем',
  }),
  OAUTH_REDIRECT_BASE_URL: Url('http', {
    default: 'http://localhost:3001',
    description: 'Базовый адрес API для callback OAuth',
  }),
  OAUTH_DISCORD_CLIENT_ID: Type.Optional(Text({ description: 'Клиент OAuth Discord' })),
  OAUTH_DISCORD_CLIENT_SECRET: Type.Optional(
    createSecretSchema({ description: 'Секрет OAuth Discord' }),
  ),
  OAUTH_GOOGLE_CLIENT_ID: Type.Optional(Text({ description: 'Клиент OAuth Google' })),
  OAUTH_GOOGLE_CLIENT_SECRET: Type.Optional(
    createSecretSchema({ description: 'Секрет OAuth Google' }),
  ),
};

export const ApiEnvSchema = Type.Object({
  ...infra,
  API_HOST: Text({ default: '127.0.0.1', description: 'Адрес HTTP API' }),
  API_PORT: Port({ default: 3001, description: 'Порт HTTP API' }),
  ...IdentityEnvFields,
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
  WORLD_PACK_DIR: Type.Optional(
    Text({ description: 'Каталог пакета мира; без него вне production — синтетический proving' }),
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
