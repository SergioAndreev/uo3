# Резервные копии и восстановление (P08)

Контракт — `openspec/specs/persistence/backup-and-restore`. Стенд: `docker-compose.yml` (PostgreSQL 17 с непрерывной архивацией WAL).

## Что включено на стенде

| Что | Где |
|---|---|
| Архивация WAL | `archive_mode=on`, `archive_timeout=60`, том `duskmarch_pg_wal` (`/wal-archive`) |
| Снимки | `pnpm backup snapshot [daily\|weekly\|monthly\|adhoc]` → `pg_basebackup` (tar, gzip, WAL внутри), шифрование AES-256-GCM, SHA-256 |
| Хранилище | `BACKUP_DIR` (по умолчанию `.local/backup`, вне репозитория); ключ — `BACKUP_ENCRYPTION_KEY` (64 hex) или локальный `local.key` |
| Каталог | таблица `backup_catalog`: `running → completed → verified`, `failed`, `expired`; в карточке — только `encryptionKeyId`, без ключа |
| Ротация | `pnpm backup prune`: 7 ежедневных, 4 еженедельных, 3 ежемесячных |
| Точки восстановления | `POST /api/v1/admin/shards/:shardId/persistence/restore-points` (`backup.manage`) или `pnpm backup restore-point <name> --reason … --actor <accountId>` |

## Учебное восстановление

```bash
pnpm backup drill                       # последний снимок + весь хвост WAL
pnpm backup drill --target 2026-11-26T14:21:55Z   # на момент времени
```

Снимок расшифровывается, сверяется SHA-256, распаковывается во временный каталог вместе с копией архива WAL и поднимается во временном контейнере `duskmarch-restore-*` (порт только на `127.0.0.1`). После выхода из восстановления проверяются инварианты мира (`checkWorldInvariants`: повтор слота, циклы контейнеров, сироты, границы аренды `EntityId`), замеряется RTO, результат пишется в каталог (`verified` или `failed` с хвостом журнала). Контейнер и временные файлы удаляются.

Замер на стенде (26.11.2026): полное восстановление — RTO 2,6 с, на момент времени — 6,4 с; инварианты в порядке. Предел — 900 с.

PITR требует хотя бы одного коммита в WAL после метки: иначе PostgreSQL завершает восстановление с «recovery ended before configured recovery target was reached».

## Полное восстановление шарда (`shard.restore`, владелец)

1. Шард в обслуживание (`POST /api/v1/admin/shards/:id/status` → `maintenance`), узлы игрового сервера остановить.
2. Проверить метку: `pnpm backup drill --target <метка>` должен дать `verified`.
3. Остановить `postgres`, заменить каталог данных распакованным снимком, положить `recovery.signal` и настройки из `recoveryConf(<метка>)`, запустить.
4. Сверка до открытия входа (P08 5.3): аренды партиций и живые сессии сброшены, границы `EntityId` подняты на `+4096`, таймеры распада продлены, инварианты проверены; при дефекте шард остаётся в `maintenance`.
