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
| `IDENTITY_JWT_SIGNING_KEYS_JSON` | JSON-массив {kid, privateKeyPem, retiredAt?} ключей Ed25519; вне production без него ключ создаётся при старте | — | да |
| `IDENTITY_JWT_ISSUER` | Поле iss Access JWT | `duskmarch` |  |
| `IDENTITY_JWT_AUDIENCE` | Поле aud Access JWT | `duskmarch-api` |  |
| `IDENTITY_TOTP_KEYS_JSON` | JSON {версия: base64 32 байта} ключей AES-256-GCM секретов TOTP | — | да |
| `IDENTITY_TOTP_KEY_VERSION` | Версия ключа TOTP для записи | `1` |  |
| `IDENTITY_BACKUP_CODE_PEPPER` | Перец HMAC резервных кодов 2FA | — | да |
| `IDENTITY_PUBLIC_URL` | Адрес клиента для ссылок в письмах | `http://localhost:5273` |  |
| `IDENTITY_TRUSTED_ORIGINS` | Origin, которым разрешены cookie-эндпоинты | `http://localhost:5273,http://localhost:5274` |  |
| `IDENTITY_TOS_VERSION` | Действующая версия условий | `2026-11-01` |  |
| `IDENTITY_PRIVACY_VERSION` | Действующая версия политики конфиденциальности | `2026-11-01` |  |
| `IDENTITY_BLOCKED_EMAIL_DOMAINS` | Запрещённые почтовые домены через запятую | — |  |
| `IDENTITY_REGISTRATION_CHALLENGE` | Антибот-проверка регистрации; поставщик проверки подключается позже | `off` |  |
| `IDENTITY_ARGON2_MEMORY_KIB` | Память argon2id, КиБ | `19456` |  |
| `IDENTITY_ARGON2_TIME_COST` | Число проходов argon2id | `2` |  |
| `MAIL_TRANSPORT` | log — письма в журнал, smtp — отправка | `log` |  |
| `MAIL_SMTP_URL` | Адрес SMTP-сервера | — | да |
| `MAIL_FROM` | Отправитель писем | `Duskmarch <no-reply@duskmarch.invalid>` |  |
| `OAUTH_REDIRECT_BASE_URL` | Базовый адрес API для callback OAuth | `http://localhost:3001` |  |
| `OAUTH_DISCORD_CLIENT_ID` | Клиент OAuth Discord | — |  |
| `OAUTH_DISCORD_CLIENT_SECRET` | Секрет OAuth Discord | — | да |
| `OAUTH_GOOGLE_CLIENT_ID` | Клиент OAuth Google | — |  |
| `OAUTH_GOOGLE_CLIENT_SECRET` | Секрет OAuth Google | — | да |
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
| `SHARD_RULESET_PRESET` | Пресет профиля правил шарда | `standard` |  |
| `SHARD_RULESET_FILE` | Файл переопределения правил шарда (JSON или YAML) | — |  |
| `WORLD_PACK_DIR` | Каталог пакета мира; без него вне production — синтетический proving | — |  |
| `GAME_NODE_ROLE` | Роль узла: партиции и хаб, только партиции, только хаб | `all` |  |
| `GAME_NODE_ID` | Идентификатор узла в heartbeat | `node-1` |  |
| `GAME_PUBLIC_WS_URL` | Адрес WebSocket узла для клиентов (публикуется в реестре комнат) | `ws://127.0.0.1:2567` |  |
| `GAME_HEARTBEAT_MS` | Период heartbeat узла, мс | `5000` |  |
| `GAME_RECONNECT_WINDOW_MS` | Окно переподключения, мс | `30000` |  |
| `GAME_IDLE_TIMEOUT_MS` | Отключение игрока за бездействие, мс (0 — выключено) | `1800000` |  |
| `GAME_SHUTDOWN_HARD_TIMEOUT_MS` | Жёсткий предел остановки, мс | `30000` |  |
| `GAME_PARTITION_CAPACITY` | Игроков на партицию | `500` |  |
| `GAME_STAFF_BUFFER` | Мест персонала сверх ёмкости | `20` |  |
| `GAME_MOTD` | Сообщение дня хаба | `Добро пожаловать на Duskmarch` |  |
| `PERSIST_FLUSH_INTERVAL_MS` | Период фонового сохранения мира, мс (10 000..300 000) | `60000` |  |
| `PERSIST_FLUSH_BATCH` | Строк в пакете записи (50..2 000) | `500` |  |
| `PERSIST_CAPTURE_BUDGET_MS` | Бюджет снимка изменений на тик, мс (1..15) | `5` |  |
| `PERSIST_MAX_UNFLUSHED_MS` | Возраст несохранённых изменений до режима `read_only_degraded`, мс | `180000` |  |
| `PERSIST_ID_BLOCK` | Размер блока аренды `EntityId` (256..65 536) | `4096` |  |
| `PERSIST_LOAD_MODE` | Битые ссылки контейнеров при загрузке: `quarantine` или `strict` | `quarantine` |  |
| `PERSIST_SHUTDOWN_FLUSH_MS` | Срок финального сохранения при остановке, мс | `25000` |  |

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
