# Duskmarch

Оригинальная браузерная sandbox-MMORPG: бесклассовое развитие через навыки, экономика игроков, дома, корабли и два плана с разными правилами PvP. Мир и правила описаны в [docs/CONCEPT.md](docs/CONCEPT.md).

## Структура

- `apps/` — `client`, `admin` (браузер), `api`, `game-server` (сервер), `asset-tool`, `bot-client` (CLI).
- `packages/` — `domain`, `rules`, `protocol`, `asset-formats`, `content`, `db`, `ui-kit`, `config`, `test-kit`. Границы: [packages/README.md](packages/README.md).
- `openspec/` и `docs/` — спецификации, архитектура, дорожная карта. Правила для агентов: [AGENTS.md](AGENTS.md).

## Пререквизиты

Node.js 22 и pnpm 9 (версия закреплена в `package.json`), Docker с Compose v2. Установка: `pnpm install --frozen-lockfile`.

## Команды

| Команда                                                 | Назначение                                             |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `pnpm build`                                            | сборка всех модулей                                    |
| `pnpm typecheck`                                        | проверка типов                                         |
| `pnpm test`                                             | модульные тесты                                        |
| `pnpm lint`                                             | статический анализ                                     |
| `pnpm format` / `pnpm format:check`                     | форматирование / его проверка                          |
| `pnpm check:boundaries`                                 | границы импорта и циклы                                |
| `pnpm check:workspace-manifests`                        | манифесты 15 модулей                                   |
| `pnpm check:env`                                        | соответствие `.env.example` схемам                     |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` | миграции и стартовые данные                            |
| `pnpm check:node`                                       | версия Node.js                                         |
| `pnpm dev`                                              | режим разработки (P00, группа 10 — ещё не реализовано) |
| `pnpm bootstrap` / `pnpm doctor` / `pnpm env:reset`     | окружение (P00, группа 8 — ещё не реализовано)         |

## Статус

Реализуется P00. Фазы P01–P36 требуют ревизии под новую концепцию до начала реализации; их описания в `docs/ROADMAP.md` и `openspec/changes/` до этого считаются устаревшими.
