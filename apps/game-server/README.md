# `@uo3/game-server`

Реалтайм игровой сервер UO3 на базе **NestJS 11 (`createApplicationContext`) + Colyseus 0.16**. В фазе P00 реализует fail-fast валидацию `GameServerEnvSchema` (код выхода `78`), санитизацию конфигурации на старте, graceful shutdown и HTTP-сервер проб здоровья.

## Эндпоинты здоровья (`GAME_HEALTH_PORT=2568`)

| Метод и путь   | Поведение                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /healthz` | Всегда HTTP `200` при живом процессе (`{ status: "ok", service: "@uo3/game-server", ... }`)                                          |
| `GET /readyz`  | Проверяет живое подключение к PostgreSQL, Valkey и NATS за ≤ `500` мс → HTTP `200` (`status: "ok"`) или `503` (`status: "degraded"`) |

## Переменные окружения

См. `apps/game-server/.env.example` (синхронизировано с `GameServerEnvSchema` через `pnpm check:env`). Порты по умолчанию: `GAME_PORT=2567`, `GAME_HEALTH_PORT=2568`.

## Команды

```bash
pnpm --filter @uo3/game-server dev
pnpm --filter @uo3/game-server build
pnpm --filter @uo3/game-server test:coverage
pnpm --filter @uo3/game-server test:integration
```
