# `@uo3/api`

Сервер мета-API UO3 на базе **NestJS 11**. В фазе P00 реализует fail-fast загрузку конфигурации (`ApiEnvSchema`, код возврата `78`), санитизацию секретов на старте, подключения к PostgreSQL 17 / Valkey 8 / NATS JetStream, graceful shutdown и эндпоинты здоровья.

## Эндпоинты здоровья

| Метод и путь   | Поведение                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz` | Всегда HTTP `200` при живом процессе (`{ status: "ok", service: "@uo3/api", ... }`)                                                                                 |
| `GET /readyz`  | Проверяет живое подключение к PostgreSQL, Valkey и NATS за ≤ `500` мс → HTTP `200` (`status: "ok"`) или `503` (`status: "degraded"`) с детализацией по зависимостям |

## Переменные окружения

См. `apps/api/.env.example` (синхронизировано с `ApiEnvSchema` через `pnpm check:env`). Порт по умолчанию: `API_PORT=3001`.

## Команды

```bash
pnpm --filter @uo3/api dev
pnpm --filter @uo3/api build
pnpm --filter @uo3/api test:coverage
pnpm --filter @uo3/api test:integration
```
