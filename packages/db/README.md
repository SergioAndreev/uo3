# `@uo3/db`

Серверный пакет доступа к PostgreSQL 17 на базе **Drizzle ORM** и `drizzle-kit`. Доступен только серверным приложениям (`apps/api`, `apps/game-server`).

## Базы данных локального стенда

- `uo3_dev` (`DATABASE_URL`) — основная база локальной разработки.
- `uo3_test` (`TEST_DATABASE_URL`) — изолированная база для интеграционных тестов (`pnpm test:integration`), никогда не затрагивающая данные в `uo3_dev`.

## Основные команды

| Команда                                  | Назначение                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm db:migrate`                        | Применяет все версионированные SQL-миграции из `packages/db/drizzle/`           |
| `pnpm db:seed`                           | Транзакционно и идемпотентно заполняет стартовые записи `platform_env_metadata` |
| `pnpm --filter @uo3/db db:generate`      | Генерирует новую SQL-миграцию после изменения схем в `src/schema/`              |
| `pnpm --filter @uo3/db db:check`         | Проверяет консистентность журнала миграций Drizzle                              |
| `pnpm --filter @uo3/db test`             | Модульные тесты (без подключения к БД)                                          |
| `pnpm --filter @uo3/db test:integration` | Интеграционные тесты против изолированной БД `uo3_test`                         |

## Правила добавления таблиц (фазы P04, P05, P08 и далее)

1. Добавляйте новые таблицы в отдельный файл `packages/db/src/schema/<domain>.ts` и реэкспортируйте из `src/schema/index.ts`.
2. После изменения схемы сгенерируйте миграцию через `pnpm --filter @uo3/db db:generate --name <migration_name>` и зафиксируйте SQL-файл и `drizzle/meta/` в git.
3. Проверьте консистентность: `pnpm --filter @uo3/db db:check`.
4. Обновите `seed.ts`, сохраняя строгую идемпотентность (`ON CONFLICT DO UPDATE`).
