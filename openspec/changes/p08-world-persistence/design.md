# Design: P08 Персистентность мира

## Context

Мотивация — в [proposal.md](proposal.md), контракт поведения — в `specs/persistence/*`. Фаза опирается на готовое: `EntityId` и `IdAllocator` с портом аренды (P00), профиль правил с `time`, `limits.logoutDelayMs`, `interest` и отпечатком (P01), версию мира `RealmStore.version()` (P03), аккаунты, разрешения, второй фактор, журнал аудита и outbox (P04), таблицы `shards`, `characters`, `character_skills`, `shard_entity_sequences` и стартовый набор героя (P05), ядро партиции с `Placement`, `hydrate`, `onDirty`, планировщик с фоновым бюджетом, порты сессий `loadHero`/`saveHero` и узел шарда (P06), сетевой слой (P07). ADR-006 (мир в памяти по секторам), ADR-008 (PostgreSQL — источник истины), ADR-012 (единственный владелец, аудит персонала).

## Goals / Non-Goals

**Goals:** загрузка партиции 100 000 сущностей ≤ 10 с; загрузка героя p99 ≤ 50 мс; фоновое сохранение без пауз (порция ≤ 5 мс на тик, p99 тика ≤ 30 мс); RPO ≤ 60 с для фона и 0 для критических операций; невозможность двух активных экземпляров одного `EntityId`; PITR с RTO ≤ 15 мин; точечный откат героя и предмета.

**Non-Goals:** правила обмена, банка, торговцев (P21); передача между партициями (P32); дашборды (P33); кластер БД (P35).

## Decisions

### D1. Реляционная модель с JSONB-компонентами
Общая таблица `world_entities` (`shard_id`, `entity_id` bigint, `kind`, `realm`, `x`, `y`, `h`, `placement` — `world`|`container`|`equipped`|`bank`|`limbo`, `parent_id`, `slot`, `root_owner_id`, `content_key`, `amount`, `components` JSONB, `schema_version`, `entity_version`, `change_seq`, `deleted_at`). Уникальные индексы: `(shard_id, entity_id)`; частичный `(shard_id, parent_id, slot) WHERE placement='equipped' AND deleted_at IS NULL`. Проверки размещения — `CHECK`. `root_owner_id` денормализует владельца дерева для загрузки героя одним запросом. Герой остаётся в `characters` P05; мировое состояние героя (банк, флаги) — `hero_world_state`.

### D2. Две загрузки: партиция потоком, герой по требованию
`WorldLoader.loadPartition(realm, bounds)` читает курсором пакетами по 5 000 строк (`ORDER BY entity_id`), связывает контейнеры в два прохода (`quarantine`|`strict`) и отдаёт сущности в `PartitionCore.hydrate`. Герои вне мира не загружаются. `loadHero` P06 расширяется: одна транзакция `REPEATABLE READ` читает строку героя, навыки и дерево по `root_owner_id`.

### D3. Аренда партиции с эпохой
Таблица `partition_leases` (`shard_id`, `partition_id`, `owner_node_id`, `epoch`, `expires_at`). Захват — `INSERT … ON CONFLICT DO UPDATE … WHERE expires_at < now()` с `epoch = epoch + 1`; продление каждые 5 с, TTL 15 с. Каждая запись пакета содержит `epoch` и проверяется в той же транзакции (`SELECT … FOR SHARE`); при расхождении — `PERSIST_FENCING_TOKEN_STALE`, узел закрывает комнату с `4117`.

### D4. Отметки изменений и снимок порциями
`DirtyTracker` подписан на `onDirty` ядра P06 (`PartitionRuntime.listeners`, как сетевой слой P07): `id → { mask, changeSeq }`. Снимок — фоновая задача планировщика P06 с бюджетом 5 мс: копирует сериализованные строки в неизменяемый буфер с `capturedChangeSeq`. После коммита отметка снимается, только если `changeSeq` не вырос.

### D5. Пакетная запись и согласование версий
`FlushCoordinator` (один цикл на партицию) пишет пакеты по 500 строк через `INSERT … SELECT FROM unnest(...) ON CONFLICT DO UPDATE … WHERE world_entities.entity_version = excluded.entity_version - 1`; пропущенные строки — конфликт версий (`versionConflictsTotal`). Порядок: создания по глубине вложенности, затем обновления, затем удаления в обратном порядке; внутри — `(kind, entity_id)`. Взаимная блокировка (`40P01`) и сериализация (`40001`) — до 3 повторов со случайным разбросом. Деградация: возраст несохранённого > 180 с или очередь > 100 000 → `read_only_degraded` (вход отклоняется, критические операции — `PERSIST_SERVICE_DEGRADED`).

### D6. Синхронный координатор критических транзакций
`CriticalTransactionCoordinator.run(tx)`: проверка режима и `idempotencyKey` → блокировки в памяти по возрастанию `EntityId` (таймаут 5 с) → включение несохранённых изменений участников и цепочки контейнеров → одна транзакция PostgreSQL (`synchronous_commit = on`): проверка версий, владельцев, баланса стопок, запись сущностей, журнала, реестра `critical_transactions` → применение в памяти только после `COMMIT`. Ядро P06 отклоняет намерения к заблокированным сущностям (`PERSIST_ENTITY_TX_LOCKED`). Типы операций — перечисление `CriticalTxType` в `packages/protocol`; правила конкретных операций добавляют P13/P21/P23/P29. Аудит персонала: надёжная запись — строки журнала предметов с `actorAccountId`, `actorAccessLevel` и обоснованием (`details.reason`) в той же транзакции; событие `shard.{id}.audit.<операция>` публикуется после коммита (повтор доставки не нужен — источник истины журнал). Баланс стопок проверяется автоматически по ключам контента всех затронутых предметов; эмиссия и сток объявляются явно (`minted`/`burned`).

### D7. Журнал предметов только для добавления
`item_ledger` секционирован по месяцам, `ledger_seq` — последовательность шарда; триггер `BEFORE UPDATE OR DELETE` запрещает изменения (как журналы P04). Индексы: `(shard_id, item_id, ledger_seq)`, `(shard_id, source_item_id)`, `(shard_id, actor_account_id, created_at)`, `(shard_id, tx_id)`. Фоновые события пишутся по политике ценности.

### D8. Копии: WAL, снимки, учебное восстановление
Локальный стенд: `archive_mode = on`, `archive_timeout = 60`, архив WAL в том Docker; снимки — `pg_basebackup` со сжатием и SHA-256, каталог `backup_catalog`. Учебное восстановление поднимает временный контейнер PostgreSQL, проигрывает WAL до метки и запускает `scripts/verify-world-invariants`. Шифрование и внешнее хранилище — через порт `BackupStorage` (файловая реализация локально; облачная — P33).

### D9. Точечный откат через предпросмотр
Предпросмотр строит разницу между текущим состоянием и клоном на метку `T` и выдаёт `previewToken` (HMAC, 15 мин). Применение — критическая транзакция `ROLLBACK_RESTORE` с `beforeSnapshot`/`afterSnapshot` в `restore_operations`. Конфликт активного `EntityId` у другого владельца — `PERSIST_RESTORE_DUPE_CONFLICT`, разрешение — `reclaim_original` или `reissue_new_id`. Отмена — обратная операция при отсутствии конфликтов, срок 30 суток.

## Architecture & Contracts

| Модуль | Ответственность |
|---|---|
| `packages/db/src/schema/world.ts`, `drizzle/0004_world_persistence.sql` | таблицы `world_entities`, `hero_world_state`, `shard_world_state`, `world_timers`, `partition_leases`, `item_ledger`, `critical_transactions`, `restore_operations`, `restore_points`, `backup_catalog`, `characters.starter_loadout_granted` |
| `packages/db/src/world` | репозитории: аренда идентификаторов и партиций, загрузка, пакетная запись, журнал |
| `packages/protocol/src/persistence` | коды `PERSIST_*`, `CriticalTxType`, схемы API администрирования |
| `packages/domain` | разрешения `items.manage` (game-master), `items.ledger.read` (game-master), `backup.manage` (administrator), `shard.restore` (owner) |
| `apps/game-server/src/persistence` | `DbIdLeaseProvider`, `PartitionLease`, `WorldLoader`, `DirtyTracker`, `FlushCoordinator`, `CriticalTransactionCoordinator`, `ItemLedger`, `TimerStore` |
| `apps/api/src/persistence` | журнал предметов, ручное сохранение (через NATS-команду узлу), точки восстановления, откаты, каталог копий |
| `scripts/backup`, `infra/compose` | снимки, архив WAL, учебное восстановление для стенда |

Ошибки (`packages/protocol/src/persistence/errors.ts`): `PERSIST_ENTITY_ID_COLLISION`, `PERSIST_VERSION_CONFLICT`, `PERSIST_OWNERSHIP_INVARIANT_VIOLATION`, `PERSIST_CONTAINER_CYCLE_DETECTED`, `PERSIST_CONTAINER_DEPTH_EXCEEDED`, `PERSIST_ENTITY_ID_RANGE_EXHAUSTED`, `PERSIST_FENCING_TOKEN_STALE`, `PERSIST_PARTITION_LEASE_HELD`, `PERSIST_CHARACTER_UNAVAILABLE`, `PERSIST_WORLD_LOAD_CORRUPTED`, `PERSIST_UNSUPPORTED_SCHEMA_VERSION`, `PERSIST_WORLD_NOT_READY`, `PERSIST_ENTITY_TX_LOCKED`, `PERSIST_TX_IDEMPOTENCY_MISMATCH`, `PERSIST_CONSERVATION_VIOLATION`, `PERSIST_TX_TIMEOUT`, `PERSIST_TX_CONFLICT`, `PERSIST_TX_UNAVAILABLE`, `PERSIST_SERVICE_DEGRADED`, `PERSIST_AUDIT_REASON_REQUIRED`, `PERSIST_HANDOFF_FLUSH_FAILED`, `PERSIST_FLUSH_COOLDOWN_ACTIVE`, `PERSIST_PITR_WINDOW_UNAVAILABLE`, `PERSIST_RESTORE_POINT_EXISTS`, `PERSIST_ROLLBACK_PREVIEW_REQUIRED`, `PERSIST_CHARACTER_ONLINE_BLOCKED`, `PERSIST_RESTORE_DUPE_CONFLICT`, `PERSIST_ROLLBACK_UNDO_EXPIRED`, `PERSIST_RECONCILIATION_FAILED`.

Конфигурация (`GameServerEnvSchema`): `PERSIST_FLUSH_INTERVAL_MS` (60 000), `PERSIST_FLUSH_BATCH` (500), `PERSIST_CAPTURE_BUDGET_MS` (5), `PERSIST_MAX_UNFLUSHED_MS` (180 000), `PERSIST_ID_BLOCK` (4 096), `PERSIST_LOAD_MODE` (`quarantine`|`strict`), `PERSIST_SHUTDOWN_FLUSH_MS` (25 000). События NATS: `shard.{id}.persistence.flushed`, `shard.{id}.persistence.degraded`, `shard.{id}.audit.*`; команда `shard.{id}.persistence.flush_request`.

Коды закрытия: `4117` (`WS_CLOSE_EPOCH_FENCED`) и `4128` (`WS_CLOSE_PARTITION_NOT_READY`) — уже в реестре.

## Risks / Trade-offs

- **Общий хост под нагрузкой** → бюджеты проверяются тестами на стенде с допуском и метриками, а не жёсткими таймингами в модульных тестах.
- **JSONB-компоненты без схемы** → схемы компонентов в `packages/domain` + `schemaVersion` и чистые миграции `v → v+1`.
- **Блокировки в памяти и намерения** → таймаут 5 с и отказ `PERSIST_ENTITY_TX_LOCKED` вместо ожидания; тест на встречные пары.
- **Учебное восстановление дорогое** → раз в 7 дней и по запросу; локально — на маленьком мире.

## Migration Plan

Миграция `0004_world_persistence` добавляет таблицы и `characters.starter_loadout_granted` (по умолчанию `false`; существующие герои стенда получают выдачу при первом входе). Узел P06 при старте: аренда партиции → границы идентификаторов → загрузка → `ready`; до этого вход отклоняется `4128`. `InMemoryIdLeaseProvider` остаётся для `HeadlessShard`.

## Open Questions

Нет.
