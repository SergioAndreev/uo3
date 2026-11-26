# Шарды, герои и игровые билеты

Модуль `apps/api/src/game` (фаза P05). Контракт — спецификации `openspec/specs/shard/*` и `openspec/specs/characters/*`.

## Устройство

| Файл | Содержимое |
|---|---|
| `shards.ts` | Каталог: видимость, статус из heartbeat, загрузка, обслуживание, версии протокола, администрирование |
| `characters.ts` | Создание, список, удаление, переименование, инструменты персонала, предохранители удаления |
| `tickets.ts` | Пара билетов, маршрутизация в партицию, резервы |
| `ports.ts` | `GameStore` (PostgreSQL) и `LivePort` (Valkey) |
| `memory/`, `infra/` | Реализации в памяти и на PostgreSQL/Valkey |
| `http/` | `/api/v1/shards`, `/api/v1/admin/shards`, `/api/v1/staff/characters` |

Правила создания — `packages/rules` (`creation`, `names`), данные — `packages/content/src/heroes`. Ключи Valkey и Lua-скрипты — `@duskmarch/db/live`.

## Для игрового сервера (P06)

- Каждые 5 с: `publishHeartbeat`, `publishPartition` (прямоугольник плана, `roomId`, ёмкость), `publishHub`; живую сессию героя — `publishSession`.
- В `onAuth` комнаты: `redeemTicket(redis, token, { shardId, roomType, roomId }, now)`. Результат `{ ok: true, payload }` содержит доверенные атрибуты героя; параметры клиента не используются. Отказы: `INVALID`, `ROOM_MISMATCH`, `EXPIRED`, `REVOKED`.

## Заголовки

- `X-Duskmarch-Protocol: x.y.z` — каталог помечает `compatible`; для билета заголовок обязателен.
- `Idempotency-Key` при создании героя — повтор возвращает тот же ответ 5 минут.
- `If-None-Match` — анонимный каталог отвечает `304`, при недоступности Valkey — заголовок `Warning` и статусы `unknown`.

## Шарды разработки

`pnpm db:seed` создаёт `local-dev` (испытательный план, город `proving-camp`) и `ember` (Заря и Марь, города Ладь, Кремнёв, Соляр). Шард остаётся `offline`, пока игровой сервер не публикует heartbeat.
