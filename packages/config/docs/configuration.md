# Управление конфигурацией и секретами (`@uo3/config`)

## Принципы

1. **Fail-fast на старте (код возврата `78`)**: каждое приложение валидирует полную TypeBox-схему до открытия сетевых портов и запуска логики. Все ошибки собираются за один проход.
2. **Детерминированный приоритет источников**:
   1. Переменные окружения процесса (`process.env`)
   2. Файлы секретов `*_FILE` (для полей `x-secret` и `x-sensitive-uri`)
   3. `.env.<NODE_ENV>.local` (отключено при `NODE_ENV=production`)
   4. `.env.local` (отключено при `NODE_ENV=production`)
   5. `.env` (отключено при `NODE_ENV=production`)
   6. Значения по умолчанию в TypeBox-схеме
3. **Разделение контекстов**: браузерные приложения используют `@uo3/config/env/client` (без `node:*`), принимающий строго `VITE_*` и отклоняющий `x-secret: true`.
4. **Автоматическое редактирование (`redactConfig` / `redactUri`)**: поля `x-secret` выводятся как `[REDACTED]`, пароли в `x-sensitive-uri` маскируются без потери хоста и порта (`postgresql://uo3:[REDACTED]@localhost:5432/uo3_dev`).
5. **Глубокая неизменяемость (`deepFreeze`)**: попытка мутации поля конфигурации в рантайме выбрасывает `TypeError`.

## Коды ошибок (`ConfigErrorCode`)

| Код | Причина |
|---|---|
| `CONFIG_VALIDATION_FAILED` | Отсутствует обязательное поле, неверный тип, диапазон или формат URL/порта/булева |
| `CONFIG_CONFLICT` | Одновременно заданы `<KEY>` и `<KEY>_FILE` |
| `CONFIG_SECRET_FILE_ERROR` | Файл `<KEY>_FILE` не существует, недоступен для чтения или пуст |
| `CONFIG_CLIENT_SECRET_FORBIDDEN` | В клиентской схеме указан ключ без `VITE_` или поле с `x-secret: true` |
| `CONFIG_INSECURE_PROD_VALUE` | В `NODE_ENV=production` обнаружен dev-плейсхолдер (`CHANGE_ME_*`, `dev-secret`, `local-only`), секрет < 32 байт или `CORS_ALLOWED_ORIGINS=*` при `CORS_ALLOW_CREDENTIALS=true` |

## Пример использования (сервер)

```ts
import { loadServerConfigOrExit } from "@uo3/config/env/server";
import { redactConfig } from "@uo3/config/env/shared";
import { ApiEnvSchema } from "@uo3/config/env/server";

const config = loadServerConfigOrExit(ApiEnvSchema, { appName: "api" });
console.info("Loaded config:", redactConfig(ApiEnvSchema, config));
```

## Файловые секреты (`*_FILE`)

Любое поле схемы с `x-secret: true` или `x-sensitive-uri: true` можно передать через файл:

```bash
export DATABASE_URL_FILE=/run/secrets/uo3_database_url
```

Завершающие `\r\n` автоматически удаляются. Одновременное задание `DATABASE_URL` и `DATABASE_URL_FILE` приводит к немедленному выходу с кодом `78` (`CONFIG_CONFLICT`).

## Реестр схем и шаблонов `.env.example`

Паритет схем и шаблонов проверяется командой `pnpm check:env` (кэшируется Turborepo):

| Область | Схема TypeBox | Шаблон | Ключевые переменные |
|---|---|---|---|
| Корень / инфраструктура | `RootInfraEnvSchema` | `.env.example` | `NODE_ENV`, `PG_*`, `VALKEY_PORT`, `NATS_*`, `OTEL_*`, `PROMETHEUS_PORT`, `LOKI_PORT`, `TEMPO_PORT`, `GRAFANA_PORT`, `DATABASE_URL`, `TEST_DATABASE_URL`, `VALKEY_URL`, `NATS_URL` |
| `apps/api` | `ApiEnvSchema` | `apps/api/.env.example` | `NODE_ENV`, `LOG_LEVEL`, `API_HOST`, `API_PORT`, `DATABASE_URL`, `VALKEY_URL`, `NATS_URL`, `IDENTITY_JWT_SIGNING_KEYS_JSON`, `CORS_ALLOWED_ORIGINS`, `CORS_ALLOW_CREDENTIALS`, `ENABLE_SWAGGER`, `SHUTDOWN_TIMEOUT_MS`, `OTEL_EXPORTER_OTLP_ENDPOINT` |
| `apps/game-server` | `GameServerEnvSchema` | `apps/game-server/.env.example` | `NODE_ENV`, `LOG_LEVEL`, `GAME_HOST`, `GAME_PORT`, `GAME_HEALTH_PORT`, `DATABASE_URL`, `VALKEY_URL`, `NATS_URL`, `SHARD_ID`, `SHUTDOWN_TIMEOUT_MS`, `OTEL_EXPORTER_OTLP_ENDPOINT` |
| `apps/client` | `ClientEnvSchema` | `apps/client/.env.example` | `VITE_APP_ENV`, `VITE_API_BASE_URL`, `VITE_GAME_WS_URL`, `VITE_ASSET_MODE`, `VITE_LOG_LEVEL` |
| `apps/admin` | `AdminEnvSchema` | `apps/admin/.env.example` | `VITE_APP_ENV`, `VITE_API_BASE_URL`, `VITE_LOG_LEVEL` |
| `apps/asset-tool` | `AssetToolEnvSchema` | `apps/asset-tool/.env.example` | `NODE_ENV`, `LOG_LEVEL`, `UO_ASSETS_INPUT_DIR`, `SYNTHETIC_OUTPUT_DIR` |
| `apps/bot-client` | `BotClientEnvSchema` | `apps/bot-client/.env.example` | `NODE_ENV`, `LOG_LEVEL`, `TARGET_API_URL`, `TARGET_GAME_WS_URL`, `BOT_CONCURRENCY` |
