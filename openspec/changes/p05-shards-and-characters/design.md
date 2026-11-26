# Design: P05 Шарды и персонажи

## Context

Фаза связывает аккаунт (P04) с героем на конкретном шарде и выдаёт одноразовый билет в мир (мотивация — [proposal.md](proposal.md)). Ограничения [ARCHITECTURE.md](../../../docs/ARCHITECTURE.md): ADR-005 (две комнаты: партиция плана и хаб шарда), ADR-006 (`EntityId` вида `hero`), ADR-007 (партиции плана; в MVP одна на план), ADR-008 (PostgreSQL — источник истины), ADR-009 (одноразовый билет ≤ 60 с), ADR-012 (сервер авторитарен).

Ревизия по CONCEPT §6: удалены правила создания чужой игры (пул статов, 49 навыков, профессии, расы, пол, хью, города, двухфасетный режим одного слота). Вместо них — собственные: три характеристики, 36 навыков шести школ, шесть предысторий, внешность из своей палитры, города Зари, планы `dawn`/`dusk` вместо фасетов. Сохранены общие инженерные решения исходного дизайна: heartbeat в Valkey, двухтокенный билет, Lua-погашение, резервирование мест, отложенное удаление.

## Goals / Non-Goals

**Goals:** четыре capability и дельты прав и профиля; проверка сценариев тестами; погашение билета, пригодное для игрового сервера без зависимости от `apps/api`.

**Non-Goals:** комнаты Colyseus и запись heartbeat (P06), материализация предметов (P13), handoff (P32), клиентские экраны (P09).

## Decisions

### D1. Каталог: PostgreSQL + heartbeat в Valkey
Конфигурация шарда — таблица `shards`. Узлы игрового сервера (P06) раз в 5 с пишут `dm:shard:{id}:hb:{nodeId}` (TTL 15 с) и реестр партиций `dm:shard:{id}:partitions` (hash, TTL 20 с), хаб — `dm:shard:{id}:hub`. API читает их одним пайплайном и вычисляет статус. Модуль `@duskmarch/db/shard-live` содержит схемы записей, запись (для P06 и тестов) и чтение. Отвергнуто: запись онлайна в PostgreSQL (нагрузка на WAL, ложный `online` при падении узла).

### D2. Пара билетов и Lua-погашение
Выдача создаёт два токена по 32 байта CSPRNG; в Valkey — `dm:ticket:{sha256}` с JSON полезной нагрузкой и TTL билета. Погашение — Lua-скрипт: читает ключ, сверяет `shardId`, `roomType`, `roomId`, срок, эпохи отзыва `dm:revoke:account:*`, `dm:revoke:char:*`, `dm:revoke:shard:*` (последняя — для уровней ниже `game-master`), удаляет ключ и резерв места. Несовпадение типа комнаты аннулирует билет (попытка подмены). Модуль `@duskmarch/db/tickets` экспортирует `redeemTicket(redis, token, room, now)` для P06. Отвергнуто: JWT как билет (нет одноразовости без реестра).

### D3. Маршрутизация и резервы
Партиция выбирается по `(realm, x, y)` из реестра. Резерв — ZSET `dm:shard:{id}:room:{roomId}:resv` (член `bundleId`, score — срок); каждая операция удаляет истёкшие (`ZREMRANGEBYSCORE`). Резервы партиции и хаба ставятся одним Lua-скриптом, сравнивающим `online + reserved` с ёмкостью (с буфером персонала). Индекс текущего пакета аккаунта `dm:shard:{id}:acct-ticket:{accountId}` позволяет заменить прежний пакет и снять его резервы.

### D4. Идентификатор героя и квоты
`EntityId` вида `hero` (ADR-006) выделяется из `shard_entity_sequences` (`UPDATE … RETURNING`) в транзакции создания; номер герою не переиспользуется. Транзакция берёт `pg_advisory_xact_lock(hashtextextended(account || ':' || shard, 0))`, проверяет квоту и выбирает наименьший свободный слот. Уникальность имени — частичный уникальный индекс `(shard_id, name_key) WHERE status <> 'deleted'` плюс таблица удержаний `character_name_holds`.

### D5. Отложенное удаление
Статусы: `active`, `rename_required`, `locked`, `pending_deletion`, `deleted`. Срок удаления — `rules.deletionGraceMs(age, skillTotal)`: 10 минут для героя младше 7 суток с суммой навыков < 120,0, иначе 72 часа. Финализация — периодический процесс в API (`UPDATE … WHERE status='pending_deletion' AND delete_at <= now RETURNING`), идемпотентна. Развитый герой удерживает имя 24 часа. Восстановление персоналом — 90 суток. Предохранители — интерфейс `DeletionGuard { check(character): Promise<string | null> }`, реестр пуст до P23/P26.

### D6. Имена
`packages/rules/names`: нормализация (NFC, пробелы, регистр слов), проверки (длина 3–16, один алфавит, ≤ 2 слова, разделители, титулы, зарезервированные и запрещённые слова из контента), скелет для уникальности (нижний регистр, `ё→е`, латинские двойники `a c e o p x y k m t h b` → кириллица; смешение алфавитов запрещено ещё до скелета).

### D7. Правила создания в профиле
Блок `creation` профиля (дельта `domain/ruleset-profile`): `standard` — пул 90, 10–60, навыки 100,0, 10,0–50,0, до 3; `proving` — навыки 200,0 при пределе навыка 100,0. Ресурсы — существующая формула `vitals` P01. `skillFeatures`: `sailing → seafaring`, `beaconry → beaconTravel`, `taming → mounts`. Навыки хранятся в десятых (`smallint`) в `character_skills`.

### D8. Контент
`packages/content/src/heroes`: типизированные модули данных (изоморфные — их импортирует и клиент): стартовые города (ключ, план, точка), шесть предысторий, базовый набор и наборы школ, служебные, зарезервированные и запрещённые имена. Тесты сверяют данные с правилами создания и размерами планов. Точки городов Зари условны до карты Зари (P25); `proving-camp` — ориентир `spawn` синтетического плана P02. `starterLoadout` — JSON `[{ key, count }]`, школы по убыванию значения навыка. Отвергнуто: YAML — потребовал бы чтения файлов в изоморфном пакете.

### D9. Идемпотентность создания
`Idempotency-Key` (до 64 символов): ключ `dm:idem:char:{account}:{shard}:{sha256(key)}` в Valkey на 5 минут с хэшем тела и ответом; повтор с иным телом — `409 IDEMPOTENCY_KEY_REUSED`.

## Architecture & Contracts

### Модель данных

| Таблица | Ключевые поля |
|---|---|
| `shards` | `id` (slug), `name`, `region`, `preset`, `ruleset_override` JSONB, `visibility`, `manual_status` (`normal`, `maintenance`, `draining`), `maintenance_eta`, `maintenance_message`, `creation_open`, `character_slots`, `rename_policy`, `ticket_ttl_s`, `soft_capacity`, `hard_capacity`, `staff_buffer`, `protocol_range`, `start_cities` text[], `sort_order`, `archived_at` |
| `shard_entity_sequences` | `shard_id`, `next_hero` |
| `characters` | `id` uuid, `shard_id`, `account_id`, `entity_id`, `slot`, `name`, `name_key`, `status`, `stats` JSONB, `appearance` JSONB, `background`, `start_city`, `realm`, `x`, `y`, `h`, `starter_loadout` JSONB, `created_at`, `last_played_at`, `delete_at`, `deleted_at`, `renamed_at`, `lock_reason` |
| `character_skills` | `character_id`, `skill`, `tenths` |
| `character_name_history` | `character_id`, `old_name`, `new_name`, `reason`, `changed_by`, `at` |
| `character_name_holds` | `shard_id`, `name_key`, `account_id`, `until` |
| `account_shard_entitlements` | `account_id`, `shard_id`, `extra_slots` |

### Ключи Valkey

| Ключ | Кто пишет | Назначение |
|---|---|---|
| `dm:shard:{id}:hb:{node}` | P06 (тесты — помощник `@duskmarch/db/shard-live`) | `{ nodeId, onlineCount, tickP99Ms, draining, updatedAt }`, TTL 15 с |
| `dm:shard:{id}:partitions` | P06 | `partitionId → { realm, minX, minY, maxX, maxY, roomId, wsUrl, hardCapacity, staffBuffer, onlineCount, draining }` |
| `dm:shard:{id}:hub` | P06 | `{ roomId, wsUrl, hardCapacity, staffBuffer, onlineCount, draining }` |
| `dm:shard:{id}:session:{account}` | P06 | живая сессия `{ characterId, state }` |
| `dm:ticket:{sha256}` | API / удаляет P06 | полезная нагрузка билета |
| `dm:shard:{id}:room:{room}:resv` | API / P06 | резервы мест |
| `dm:revoke:{account|char|shard}:{id}` | API | эпоха отзыва, TTL 120 с |

### REST (`/api/v1`)

| Метод и путь | Capability |
|---|---|
| `GET /shards`, `GET /shards/:id`, `POST /admin/shards`, `PATCH /admin/shards/:id`, `POST /admin/shards/:id/status` | каталог |
| `POST /shards/:id/tickets` | билеты |
| `GET /shards/:id/creation-options`, `POST /shards/:id/names/validate`, `POST /shards/:id/characters` | создание |
| `GET /shards/:id/characters`, `DELETE /shards/:id/characters/:cid`, `POST …/:cid/restore`, `POST …/:cid/rename`, `POST /staff/characters/:cid/{rename-required,lock,unlock,restore}` | список героев |

Ошибки — формат P04 `{ error: { code, message, details } }`; коды `SHARD_*`, `TICKET_*`, `CHAR_*`, `IDEMPOTENCY_KEY_REUSED` добавляются в реестр ошибок протокола.

### События NATS
`shard.{id}.status_changed`, `shard.{id}.config_updated`, `character.locked`, `character.rename_required` — через outbox P04 (`identity_outbox` служит общим outbox API).

## Risks / Trade-offs

- **Нет карты Зари** → точки городов условны, план `dawn` P01 имеет размеры; заменятся в P25 без смены контракта.
- **Lua в Valkey** → интеграционные тесты на настоящем Valkey; unit-тесты — на реализации в памяти с той же семантикой.
- **Гонки имён и слотов** → уникальный индекс и рекомендательная блокировка, тесты конкуренции на PostgreSQL.

## Migration Plan

Миграция `0002_shards_characters.sql`; `seed` добавляет шарды разработки `local-dev` (пресет `proving`, совпадает с `SHARD_ID` игрового сервера по умолчанию) и `ember` (пресет `standard`). Профиль `duskmarch` переходит на версию 2; отпечаток меняется, клиенты P09 ещё не существуют.

## Open Questions

Нет.
