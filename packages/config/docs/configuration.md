# Конфигурация

Схема — объект TypeBox; метаданные `x-secret`, `x-sensitive-uri`, `x-crypto-key` и `x-protocols`
управляют чтением файлов, маскированием и проверками.

```ts
import { ApiEnvSchema, loadServerConfigOrExit, redactConfig } from '@duskmarch/config/env/server';

const config = loadServerConfigOrExit(ApiEnvSchema); // ошибка → stderr и код 78
console.log(redactConfig(ApiEnvSchema, config));
```

В браузере: `loadClientConfig(ClientEnvSchema, import.meta.env)`; допустимы только `VITE_*`.

## Источники по убыванию приоритета

1. окружение процесса; 2. файл из `<KEY>_FILE` (только секретные поля); 3. `.env.<NODE_ENV>.local`;
4. `.env.local`; 5. `.env`; 6. значение схемы по умолчанию.

При `NODE_ENV=production` файлы `.env*` не читаются. `NODE_ENV` берётся только из процесса.
Пустая строка означает «не задано». `KEY` и `KEY_FILE` в одном источнике — конфликт.

## Коды ошибок

| Код | Причина |
| --- | --- |
| `CONFIG_VALIDATION_FAILED` | нет значения, неверный тип, формат или диапазон |
| `CONFIG_CONFLICT` | заданы `KEY` и `KEY_FILE` |
| `CONFIG_SECRET_FILE_ERROR` | файл секрета отсутствует, недоступен или пуст |
| `CONFIG_CLIENT_SECRET_FORBIDDEN` | секрет или ключ без `VITE_` в клиентской схеме |
| `CONFIG_INSECURE_PROD_VALUE` | заглушка, короткий ключ или небезопасный CORS в production |

## Переменные

`*.env.example` сверяются со схемами командой `pnpm check:env`.

### Корень

| Переменная | Описание | По умолчанию | Секрет |
| --- | --- | --- | --- |
| `PG_USER` | Пользователь PostgreSQL | `duskmarch` |  |
| `PG_PASSWORD` | Пароль PostgreSQL | обязательна | да |
| `PG_PORT` | Порт PostgreSQL | `5432` |  |
| `VALKEY_PORT` | Порт Valkey | `6379` |  |
| `NATS_PORT` | Порт NATS | `4222` |  |
| `NATS_MONITOR_PORT` | Порт мониторинга NATS | `8222` |  |
| `OTEL_GRPC_PORT` | Порт OTLP gRPC | `4317` |  |
| `OTEL_HTTP_PORT` | Порт OTLP HTTP | `4318` |  |
| `PROMETHEUS_PORT` | Порт Prometheus | `9090` |  |
| `LOKI_PORT` | Порт Loki | `3100` |  |
| `TEMPO_PORT` | Порт Tempo | `3200` |  |
| `GRAFANA_PORT` | Порт Grafana | `3000` |  |
| `DATABASE_URL` | Подключение к PostgreSQL | обязательна | да |
| `DATABASE_TEST_URL` | База интеграционных тестов | — | да |

### api

| Переменная | Описание | По умолчанию | Секрет |
| --- | --- | --- | --- |
| `NODE_ENV` | Среда выполнения | `development` |  |
| `LOG_LEVEL` | Уровень логирования | `info` |  |
| `DATABASE_URL` | Подключение к PostgreSQL | обязательна | да |
| `VALKEY_URL` | Подключение к Valkey | обязательна | да |
| `VALKEY_PASSWORD` | Пароль Valkey | — | да |
| `NATS_URL` | Подключение к NATS | обязательна | да |
| `NATS_PASSWORD` | Пароль NATS | — | да |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Адрес OTLP-коллектора | — |  |
| `SHUTDOWN_TIMEOUT_MS` | Предел плавной остановки, мс | `15000` |  |
| `API_HOST` | Адрес HTTP API | `127.0.0.1` |  |
| `API_PORT` | Порт HTTP API | `3001` |  |
| `IDENTITY_JWT_SIGNING_KEYS_JSON` | Ключи Ed25519 (формат задаёт P04) | — | да |
| `CORS_ALLOWED_ORIGINS` | Разрешённые origin через запятую | `http://localhost:5273` |  |
| `CORS_ALLOW_CREDENTIALS` | Разрешить cookie в CORS | `true` |  |
| `ENABLE_SWAGGER` | Публиковать OpenAPI UI | `false` |  |

### game-server

| Переменная | Описание | По умолчанию | Секрет |
| --- | --- | --- | --- |
| `NODE_ENV` | Среда выполнения | `development` |  |
| `LOG_LEVEL` | Уровень логирования | `info` |  |
| `DATABASE_URL` | Подключение к PostgreSQL | обязательна | да |
| `VALKEY_URL` | Подключение к Valkey | обязательна | да |
| `VALKEY_PASSWORD` | Пароль Valkey | — | да |
| `NATS_URL` | Подключение к NATS | обязательна | да |
| `NATS_PASSWORD` | Пароль NATS | — | да |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Адрес OTLP-коллектора | — |  |
| `SHUTDOWN_TIMEOUT_MS` | Предел плавной остановки, мс | `15000` |  |
| `GAME_HOST` | Адрес игрового сервера | `127.0.0.1` |  |
| `GAME_PORT` | Порт WebSocket | `2567` |  |
| `GAME_HEALTH_PORT` | Порт проверок здоровья | `2568` |  |
| `SHARD_ID` | Идентификатор шарда | `local-dev` |  |

### asset-tool

| Переменная | Описание | По умолчанию | Секрет |
| --- | --- | --- | --- |
| `NODE_ENV` | Среда выполнения | `development` |  |
| `LOG_LEVEL` | Уровень логирования | `info` |  |
| `ASSETS_INPUT_DIR` | Каталог исходных ассетов | — |  |
| `SYNTHETIC_OUTPUT_DIR` | Каталог синтетического мира | `./local-assets` |  |

### bot-client

| Переменная | Описание | По умолчанию | Секрет |
| --- | --- | --- | --- |
| `NODE_ENV` | Среда выполнения | `development` |  |
| `LOG_LEVEL` | Уровень логирования | `info` |  |
| `TARGET_API_URL` | Адрес API | обязательна |  |
| `TARGET_GAME_WS_URL` | Адрес игрового сервера | обязательна |  |
| `BOT_CONCURRENCY` | Число ботов | `1` |  |

### client

| Переменная | Описание | По умолчанию | Секрет |
| --- | --- | --- | --- |
| `VITE_APP_ENV` | Среда приложения | `development` |  |
| `VITE_API_BASE_URL` | Адрес API | обязательна |  |
| `VITE_LOG_LEVEL` | Уровень логирования | `info` |  |
| `VITE_GAME_WS_URL` | Адрес игрового сервера | обязательна |  |
| `VITE_ASSET_MODE` | Источник ассетов | `synthetic` |  |

### admin

| Переменная | Описание | По умолчанию | Секрет |
| --- | --- | --- | --- |
| `VITE_APP_ENV` | Среда приложения | `development` |  |
| `VITE_API_BASE_URL` | Адрес API | обязательна |  |
| `VITE_LOG_LEVEL` | Уровень логирования | `info` |  |

### db

| Переменная | Описание | По умолчанию | Секрет |
| --- | --- | --- | --- |
| `NODE_ENV` | Среда выполнения | `development` |  |
| `LOG_LEVEL` | Уровень логирования | `info` |  |
| `DATABASE_URL` | Подключение к PostgreSQL | обязательна | да |
| `DATABASE_TEST_URL` | База интеграционных тестов | — | да |
