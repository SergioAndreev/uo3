# @duskmarch/game-server

Игровой сервер (NestJS + Colyseus). Порты по умолчанию: 2567 (WebSocket), 2568 (здоровье).

- `GET /healthz` — процесс жив: всегда `200 {"status":"ok"}`.
- `GET /readyz` — пробы PostgreSQL, Valkey и NATS: `200`, если все `up`, иначе `503`. Ответ не дольше 500 мс:

```json
{ "status": "unavailable", "dependencies": { "postgres": "up", "valkey": "up", "nats": "down" } }
```

Переменные описаны в `.env.example` и `packages/config/docs/configuration.md`. Ошибка конфигурации завершает процесс с кодом `78`.

Запуск: `pnpm --filter @duskmarch/game-server dev`; сборка и запуск: `build`, затем `start`.
