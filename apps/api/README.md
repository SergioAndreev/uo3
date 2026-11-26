# @duskmarch/api

REST API (NestJS). Порты по умолчанию: 3001.

- `GET /healthz` — процесс жив: всегда `200 {"status":"ok"}`.
- `GET /readyz` — пробы PostgreSQL, Valkey и NATS: `200`, если все `up`, иначе `503`. Ответ не дольше 500 мс:

```json
{ "status": "unavailable", "dependencies": { "postgres": "up", "valkey": "up", "nats": "down" } }
```

Аккаунты, сессии, 2FA и права персонала (`/api/v1/auth`, `/api/v1/account`, `/api/v1/staff`, `/.well-known/jwks.json`) — [docs/identity.md](docs/identity.md).

Переменные описаны в `.env.example` и `packages/config/docs/configuration.md`. Ошибка конфигурации завершает процесс с кодом `78`.

Запуск: `pnpm --filter @duskmarch/api dev`; сборка и запуск: `build`, затем `start`.
