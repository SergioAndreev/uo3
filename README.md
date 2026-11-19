# UO3 — Веб-MMORPG в духе Ultima Online

> **Статус репозитория:** spec-driven разработка через OpenSpec (`/opsx-apply` → `/opsx-archive`). Базовый фундамент монорепозитория разворачивается в фазе **P00 (`p00-monorepo-foundation`)**; дальнейшие подсистемы реализуются пофазно строго по графу зависимостей в [docs/ROADMAP.md](docs/ROADMAP.md).

Полное, автономно спроектированное и строго провалидированное техническое задание и монорепозиторий для разработки **браузерного клиента** (React 19 + Three.js) и **авторитарного распределённого сервера** (NestJS 11 + Colyseus 0.16) MMORPG, воспроизводящей геймплей **Ultima Online эпохи Renaissance (UO:R)**.

## Пререквизиты

- **Node.js 22 LTS** (`>=22.0.0 <23.0.0`, зафиксировано в `.nvmrc` и `.node-version`)
- **pnpm 9** (`pnpm@9.15.9` через Corepack, зафиксировано в `package.json#packageManager`)
- **Docker Engine + Docker Compose v2** (для локального стенда PostgreSQL 17, Valkey 8, NATS JetStream и опционального стека наблюдаемости)

## Быстрый старт за 10 минут

```bash
# 1. Однокомандный идемпотентный bootstrap (проверка Node/Docker, .env, контейнеры, миграции, seed, doctor)
pnpm install --frozen-lockfile
pnpm bootstrap

# 2. Диагностика окружения
pnpm run doctor

# 3. Параллельный запуск каркасов api, game-server, client и admin
pnpm dev

# 4. Чистый сброс локальных БД (только localhost/127.0.0.1/::1/postgres)
pnpm env:reset --yes
```

Опциональный стек наблюдаемости (OTel Collector, Prometheus, Loki, Tempo, Grafana):

```bash
docker compose --profile core --profile observability up -d --wait
```

## Структура монорепозитория

### Приложения (`apps/*`)

| Путь               | Пакет              | Назначение                                                                 |
| ------------------ | ------------------ | -------------------------------------------------------------------------- |
| `apps/client`      | `@uo3/client`      | Игровой браузерный клиент (React 19 + Vite 6 + Three.js)                   |
| `apps/api`         | `@uo3/api`         | Мета-API сервер (NestJS 11: аккаунты, персонажи, шарды, тикеты, admin API) |
| `apps/game-server` | `@uo3/game-server` | Реалтайм игровой сервер (NestJS 11 ApplicationContext + Colyseus 0.16)     |
| `apps/admin`       | `@uo3/admin`       | Веб-консоль персонала (React 19 + Vite 6)                                  |
| `apps/asset-tool`  | `@uo3/asset-tool`  | Node 22 CLI для валидации/конвертации ассетов и генерации тестового мира   |
| `apps/bot-client`  | `@uo3/bot-client`  | Headless Node 22 клиент для нагрузочных и сценарных тестов                 |

### Общие пакеты (`packages/*`)

| Путь                  | Пакет             | Назначение                                                                          |
| --------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `packages/config`     | `@uo3/config`     | Пресеты TS/ESLint/Prettier/Vitest и типизированный загрузчик конфигурации (TypeBox) |
| `packages/domain`     | `@uo3/domain`     | Чистое изоморфное доменное ядро (типы, перечисления, координаты, серийники)         |
| `packages/rules`      | `@uo3/rules`      | Изоморфные детерминированные формулы правил и профиль эпохи UO:R                    |
| `packages/protocol`   | `@uo3/protocol`   | Изоморфные контракты сообщений клиент↔сервер, опкоды и схемы состояния              |
| `packages/uo-formats` | `@uo3/uo-formats` | Изоморфные парсеры бинарных форматов UO (MUL/UOP/IDX и др.)                         |
| `packages/content`    | `@uo3/content`    | Игровые определения контента (YAML + JSON Schema)                                   |
| `packages/db`         | `@uo3/db`         | Серверный слой PostgreSQL 17 + Drizzle ORM, миграции и идемпотентный `seed`         |
| `packages/ui-kit`     | `@uo3/ui-kit`     | Браузерная библиотека компонентов гампов и дизайн-токенов (React 19)                |
| `packages/test-kit`   | `@uo3/test-kit`   | Dev-only тестовые хелперы, фабрики, фейковые часы и детерминированный RNG           |

## Каталог корневых команд

| Команда                          | Назначение                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm bootstrap`                 | Однокомандная идемпотентная инициализация локального окружения                                  |
| `pnpm run doctor`                | Диагностика пререквизитов, Docker, портов, `.env` и подключений к PG/Valkey/NATS                |
| `pnpm env:reset --yes`           | Чистый сброс локальной БД/томов с защитой от нелокальных хостов                                 |
| `pnpm dev`                       | Параллельный локальный запуск `api`, `game-server`, `client` и `admin`                          |
| `pnpm build`                     | Топологическая сборка всех 15 приложений и пакетов через Turborepo                              |
| `pnpm typecheck`                 | Строгая проверка типов TypeScript во всём монорепозитории                                       |
| `pnpm lint`                      | Статический анализ ESLint и архитектурных границ                                                |
| `pnpm format`                    | Автоматическое форматирование кода через Prettier                                               |
| `pnpm format:check`              | Проверка соответствия кода форматированию Prettier                                              |
| `pnpm test`                      | Запуск быстрых модульных тестов (`unit`)                                                        |
| `pnpm test:coverage`             | Прогон тестов с проверкой послойных порогов покрытия (`85%/80%` ядро, `70%/65%` остальные)      |
| `pnpm test:integration`          | Интеграционные тесты против локальной тестовой БД `uo3_test`, Valkey и NATS                     |
| `pnpm check:boundaries`          | Проверка направленного ациклического графа (DAG) и изоляции слоёв (`dependency-cruiser`)        |
| `pnpm check:workspace-manifests` | Проверка целостности `package.json` всех 15 модулей и `onlyBuiltDependencies`                   |
| `pnpm check:env`                 | Проверка паритета TypeBox-схем конфигурации и всех файлов `.env.example`                        |
| `pnpm check:assets`              | Гейт правовой чистоты ADR-002 (запрет проприетарных файлов UO и незадекларированных бинарников) |
| `pnpm check:secrets`             | Сканирование на утечки секретов и приватных ключей                                              |
| `pnpm check:licenses`            | Проверка дерева зависимостей по белому списку SPDX-лицензий                                     |
| `pnpm check:audit`               | Аудит `critical`/`high` уязвимостей с контролем сроков временных исключений                     |
| `pnpm check:changeset`           | Проверка наличия changeset при изменении производственного кода                                 |
| `pnpm check:ci-integrity`        | Проверка SHA-пиннинга GitHub Actions, прав `GITHUB_TOKEN`, ruleset и паритета Docker-образов    |
| `pnpm db:migrate`                | Применение версионированных SQL-миграций PostgreSQL                                             |
| `pnpm db:seed`                   | Идемпотентное наполнение стартовых метаданных БД                                                |

## Масштаб спецификации

| Показатель                                             |           Значение |
| ------------------------------------------------------ | -----------------: |
| Фазы реализации (`openspec/changes/p00..p36`)          |             **37** |
| Уникальные capabilities (`specs/**/spec.md`)           |            **165** |
| Нормативные требования (`SHALL` / `MUST`)              |          **1 458** |
| Тестируемые сценарии (`WHEN` / `THEN`)                 |          **3 464** |
| Пронумерованные группы задач                           |            **592** |
| Атомарные проверяемые задачи (`- [ ]`)                 |          **4 327** |
| Mermaid-диаграммы в `design.md`                        |            **102** |
| Объём спецификаций                                     |  **~43 000 строк** |
| Строгая валидация (`openspec validate --all --strict`) | **37 / 37 PASSED** |

## Сквозная документация (читать в первую очередь)

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 13 архитектурных решений (ADR-001..ADR-013), стек, топология, канонические константы UO:R.
- [docs/ROADMAP.md](docs/ROADMAP.md) — вехи (M0–M5), граф зависимостей фаз и контрактный реестр всех 165 capabilities.
- [docs/GLOSSARY.md](docs/GLOSSARY.md) — глоссарий терминов Ultima Online и системной архитектуры.
- [docs/PROTOCOL_REGISTRY.md](docs/PROTOCOL_REGISTRY.md) — единый бесколлизионный реестр `uint16`-опкодов `@uo3/protocol` и кодов закрытия WebSocket (`4100..4199`).
- [AGENTS.md](AGENTS.md) — правила работы ИИ-агентов с репозиторием.
- [openspec/config.yaml](openspec/config.yaml) — конфигурация OpenSpec (`schema: spec-driven`, контекст и правила артефактов).

## Зафиксированный стек технологий

- **Язык и монорепо:** TypeScript 5 (strict, ESM), Node.js 22 LTS, pnpm workspaces + Turborepo.
- **Клиент (`apps/client`):** React 19, Vite 6, Three.js + `@react-three/fiber` + `drei` (2.5D изометрический рендерер в WebGL2 + опциональный WebGPU, depth-кодированный порядок отрисовки UO, GPU ID-пикинг, палитрные шейдеры хью), Zustand 5, TanStack Query 5, Web Workers, OPFS-кэш ассетов, React DOM-оверлей для декларативных серверных гампов, PWA.
- **Сервер API (`apps/api`):** NestJS 11 (REST + OpenAPI `/api/v1/*`, EdDSA JWT, argon2id, TOTP 2FA, OAuth, аккаунты, персонажи, шарды, одноразовые game tickets, админ-API).
- **Игровой сервер (`apps/game-server`):** NestJS application context + Colyseus 0.16 (`@colyseus/schema` v3 + `StateView` для AOI 18/24/31 тайлов, `uWebSockets.js`), комнаты `WorldPartitionRoom` (тик 20 Гц, иерархическое колесо таймеров, сектора 16×16) и `ShardHubRoom`.
- **Инфраструктура и данные:** PostgreSQL 17 + Drizzle ORM (инкрементальный flush 60 с без паузы мира + синхронные критические транзакции RPO=0 + `item_ledger` + PITR), Valkey 8, NATS JetStream (межпартиционная шина, ghost-репликация, бесшовный handoff), OpenTelemetry + Prometheus + Grafana + Loki + Tempo + Sentry, Docker / Kubernetes / Helm.
- **Тестирование и инструменты:** Vitest, Playwright (SwiftShader WebGL), симуляционный харнес (фейковые часы + `xoshiro128++`), `apps/asset-tool` CLI, `apps/bot-client` (≥ 2 000 нагрузочных ботов), `apps/admin` (веб-консоль персонала).

## Как разрабатывать проект (AI Studio / Antigravity / OpenSpec)

Репозиторий преднастроен для OpenSpec (`openspec init` с адаптерами для **Antigravity**, **Gemini CLI / AI Studio**, **Claude Code** и универсальных `.agents` skills).

1. Убедитесь, что установлен OpenSpec CLI (`npm i -g @fission-ai/openspec`):
   ```bash
   openspec list
   openspec validate --all --strict
   ```
2. Выберите следующую незаархивированную фазу по графу зависимостей в [docs/ROADMAP.md](docs/ROADMAP.md) (начинать строго с `p00-monorepo-foundation`).
3. Запустите реализацию фазы в вашем ИИ-инструменте:
   - Antigravity / AI Studio: `/opsx-apply p00-monorepo-foundation`
   - Gemini CLI / Claude Code: `/opsx:apply p00-monorepo-foundation`
   - CLI-инструкции вручную: `openspec instructions apply --change p00-monorepo-foundation`
4. Выполняйте задачи из `tasks.md` строго по порядку; отмечайте `- [x]` только после прохождения проверки, указанной в строке задачи. Сценарии `WHEN`/`THEN` из `specs/**/spec.md` реализуйте как автотесты.
5. После закрытия всех задач фазы провалидируйте и заархивируйте её:
   ```bash
   openspec validate p00-monorepo-foundation --strict
   openspec archive p00-monorepo-foundation
   ```
   Архивация перенесёт дельта-спецификации в `openspec/specs/` и разблокирует зависимые фазы.

## Полный каталог фаз (P00–P36)

| Фаза      | Change ID (Proposal)                                                                                  | Название                              |    Caps |     Треб. |     Сцен. |   Групп |     Задач | Артефакты                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------- | ------: | --------: | --------: | ------: | --------: | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **P00**   | [`p00-monorepo-foundation`](openspec/changes/p00-monorepo-foundation/proposal.md)                     | Фундамент монорепозитория             |       5 |        45 |       109 |      15 |       124 | [design](openspec/changes/p00-monorepo-foundation/design.md) · [tasks](openspec/changes/p00-monorepo-foundation/tasks.md)                     |
| **P01**   | [`p01-shared-domain-model`](openspec/changes/p01-shared-domain-model/proposal.md)                     | Общая доменная модель и правила       |       5 |        48 |       125 |      15 |       122 | [design](openspec/changes/p01-shared-domain-model/design.md) · [tasks](openspec/changes/p01-shared-domain-model/tasks.md)                     |
| **P02**   | [`p02-uo-asset-formats-and-import`](openspec/changes/p02-uo-asset-formats-and-import/proposal.md)     | Форматы UO и импорт клиентских данных |       5 |        44 |       105 |      15 |       124 | [design](openspec/changes/p02-uo-asset-formats-and-import/design.md) · [tasks](openspec/changes/p02-uo-asset-formats-and-import/tasks.md)     |
| **P03**   | [`p03-server-world-data`](openspec/changes/p03-server-world-data/proposal.md)                         | Серверные данные статического мира    |       3 |        36 |       108 |      15 |       124 | [design](openspec/changes/p03-server-world-data/design.md) · [tasks](openspec/changes/p03-server-world-data/tasks.md)                         |
| **P04**   | [`p04-identity-and-accounts`](openspec/changes/p04-identity-and-accounts/proposal.md)                 | Идентификация и аккаунты              |       5 |        45 |       117 |      15 |       121 | [design](openspec/changes/p04-identity-and-accounts/design.md) · [tasks](openspec/changes/p04-identity-and-accounts/tasks.md)                 |
| **P05**   | [`p05-shards-and-characters`](openspec/changes/p05-shards-and-characters/proposal.md)                 | Шарды и персонажи                     |       4 |        40 |       116 |      15 |       119 | [design](openspec/changes/p05-shards-and-characters/design.md) · [tasks](openspec/changes/p05-shards-and-characters/tasks.md)                 |
| **P06**   | [`p06-game-server-runtime`](openspec/changes/p06-game-server-runtime/proposal.md)                     | Среда выполнения игрового сервера     |       6 |        56 |       134 |      15 |       125 | [design](openspec/changes/p06-game-server-runtime/design.md) · [tasks](openspec/changes/p06-game-server-runtime/tasks.md)                     |
| **P07**   | [`p07-netcode-and-replication`](openspec/changes/p07-netcode-and-replication/proposal.md)             | Сетевой код и репликация              |       4 |        40 |        97 |      15 |       124 | [design](openspec/changes/p07-netcode-and-replication/design.md) · [tasks](openspec/changes/p07-netcode-and-replication/tasks.md)             |
| **P08**   | [`p08-world-persistence`](openspec/changes/p08-world-persistence/proposal.md)                         | Персистентность мира                  |       4 |        38 |        94 |      15 |       124 | [design](openspec/changes/p08-world-persistence/design.md) · [tasks](openspec/changes/p08-world-persistence/tasks.md)                         |
| **P09**   | [`p09-client-shell`](openspec/changes/p09-client-shell/proposal.md)                                   | Оболочка клиента                      |       4 |        40 |       100 |      15 |       104 | [design](openspec/changes/p09-client-shell/design.md) · [tasks](openspec/changes/p09-client-shell/tasks.md)                                   |
| **P10**   | [`p10-world-renderer`](openspec/changes/p10-world-renderer/proposal.md)                               | Рендерер мира                         |       7 |        58 |       125 |      15 |       129 | [design](openspec/changes/p10-world-renderer/design.md) · [tasks](openspec/changes/p10-world-renderer/tasks.md)                               |
| **P11**   | [`p11-mobile-visuals`](openspec/changes/p11-mobile-visuals/proposal.md)                               | Визуализация мобайлов                 |       2 |        23 |        64 |      15 |       122 | [design](openspec/changes/p11-mobile-visuals/design.md) · [tasks](openspec/changes/p11-mobile-visuals/tasks.md)                               |
| **P12**   | [`p12-movement-and-navigation`](openspec/changes/p12-movement-and-navigation/proposal.md)             | Движение и навигация                  |       5 |        40 |        82 |      15 |       120 | [design](openspec/changes/p12-movement-and-navigation/design.md) · [tasks](openspec/changes/p12-movement-and-navigation/tasks.md)             |
| **P13**   | [`p13-items-and-containers`](openspec/changes/p13-items-and-containers/proposal.md)                   | Предметы и контейнеры                 |       5 |        40 |        83 |      15 |       120 | [design](openspec/changes/p13-items-and-containers/design.md) · [tasks](openspec/changes/p13-items-and-containers/tasks.md)                   |
| **P14**   | [`p14-client-gump-ui`](openspec/changes/p14-client-gump-ui/proposal.md)                               | Интерфейс гампов                      |       7 |        49 |        98 |      15 |       110 | [design](openspec/changes/p14-client-gump-ui/design.md) · [tasks](openspec/changes/p14-client-gump-ui/tasks.md)                               |
| **P15**   | [`p15-stats-and-skills`](openspec/changes/p15-stats-and-skills/proposal.md)                           | Статы и навыки                        |       4 |        32 |        64 |      15 |       109 | [design](openspec/changes/p15-stats-and-skills/design.md) · [tasks](openspec/changes/p15-stats-and-skills/tasks.md)                           |
| **P16**   | [`p16-combat`](openspec/changes/p16-combat/proposal.md)                                               | Бой                                   |       5 |        40 |        84 |      15 |       120 | [design](openspec/changes/p16-combat/design.md) · [tasks](openspec/changes/p16-combat/tasks.md)                                               |
| **P17**   | [`p17-notoriety-and-pvp`](openspec/changes/p17-notoriety-and-pvp/proposal.md)                         | Нотореити и PvP                       |       5 |        40 |        80 |      15 |       120 | [design](openspec/changes/p17-notoriety-and-pvp/design.md) · [tasks](openspec/changes/p17-notoriety-and-pvp/tasks.md)                         |
| **P18**   | [`p18-magic`](openspec/changes/p18-magic/proposal.md)                                                 | Магия                                 |       5 |        40 |        83 |      15 |       103 | [design](openspec/changes/p18-magic/design.md) · [tasks](openspec/changes/p18-magic/tasks.md)                                                 |
| **P19**   | [`p19-npc-ai-and-creatures`](openspec/changes/p19-npc-ai-and-creatures/proposal.md)                   | NPC, ИИ и существа                    |       6 |        42 |        86 |      15 |       106 | [design](openspec/changes/p19-npc-ai-and-creatures/design.md) · [tasks](openspec/changes/p19-npc-ai-and-creatures/tasks.md)                   |
| **P20**   | [`p20-gathering-and-crafting`](openspec/changes/p20-gathering-and-crafting/proposal.md)               | Сбор ресурсов и крафт                 |       4 |        32 |        63 |      15 |       110 | [design](openspec/changes/p20-gathering-and-crafting/design.md) · [tasks](openspec/changes/p20-gathering-and-crafting/tasks.md)               |
| **P21**   | [`p21-economy-and-trade`](openspec/changes/p21-economy-and-trade/proposal.md)                         | Экономика и торговля                  |       5 |        40 |        77 |      15 |       105 | [design](openspec/changes/p21-economy-and-trade/design.md) · [tasks](openspec/changes/p21-economy-and-trade/tasks.md)                         |
| **P22**   | [`p22-utility-skills`](openspec/changes/p22-utility-skills/proposal.md)                               | Утилитарные навыки                    |       5 |        40 |        80 |      15 |       115 | [design](openspec/changes/p22-utility-skills/design.md) · [tasks](openspec/changes/p22-utility-skills/tasks.md)                               |
| **P23**   | [`p23-housing`](openspec/changes/p23-housing/proposal.md)                                             | Дома                                  |       5 |        40 |        78 |      15 |       120 | [design](openspec/changes/p23-housing/design.md) · [tasks](openspec/changes/p23-housing/tasks.md)                                             |
| **P24**   | [`p24-boats-and-sea`](openspec/changes/p24-boats-and-sea/proposal.md)                                 | Корабли и море                        |       2 |        22 |        45 |      15 |       106 | [design](openspec/changes/p24-boats-and-sea/design.md) · [tasks](openspec/changes/p24-boats-and-sea/tasks.md)                                 |
| **P25**   | [`p25-world-regions-and-environment`](openspec/changes/p25-world-regions-and-environment/proposal.md) | Регионы и окружение                   |       4 |        32 |        68 |      15 |       120 | [design](openspec/changes/p25-world-regions-and-environment/design.md) · [tasks](openspec/changes/p25-world-regions-and-environment/tasks.md) |
| **P26**   | [`p26-social-systems`](openspec/changes/p26-social-systems/proposal.md)                               | Социальные системы                    |       5 |        40 |        74 |      15 |       105 | [design](openspec/changes/p26-social-systems/design.md) · [tasks](openspec/changes/p26-social-systems/tasks.md)                               |
| **P27**   | [`p27-quests-and-world-events`](openspec/changes/p27-quests-and-world-events/proposal.md)             | Квесты и события                      |       4 |        32 |        74 |      15 |       117 | [design](openspec/changes/p27-quests-and-world-events/design.md) · [tasks](openspec/changes/p27-quests-and-world-events/tasks.md)             |
| **P28**   | [`p28-audio-and-effects`](openspec/changes/p28-audio-and-effects/proposal.md)                         | Звук и эффекты                        |       3 |        36 |       107 |      15 |       116 | [design](openspec/changes/p28-audio-and-effects/design.md) · [tasks](openspec/changes/p28-audio-and-effects/tasks.md)                         |
| **P29**   | [`p29-staff-tools-and-admin`](openspec/changes/p29-staff-tools-and-admin/proposal.md)                 | Инструменты персонала                 |       4 |        36 |        76 |      15 |       120 | [design](openspec/changes/p29-staff-tools-and-admin/design.md) · [tasks](openspec/changes/p29-staff-tools-and-admin/tasks.md)                 |
| **P30**   | [`p30-content-pipeline`](openspec/changes/p30-content-pipeline/proposal.md)                           | Контент-пайплайн                      |       4 |        36 |        75 |      15 |       114 | [design](openspec/changes/p30-content-pipeline/design.md) · [tasks](openspec/changes/p30-content-pipeline/tasks.md)                           |
| **P31**   | [`p31-security-and-anti-cheat`](openspec/changes/p31-security-and-anti-cheat/proposal.md)             | Безопасность и античит                |       5 |        45 |       132 |      15 |       116 | [design](openspec/changes/p31-security-and-anti-cheat/design.md) · [tasks](openspec/changes/p31-security-and-anti-cheat/tasks.md)             |
| **P32**   | [`p32-world-scaling`](openspec/changes/p32-world-scaling/proposal.md)                                 | Масштабирование мира                  |       4 |        36 |       108 |      15 |       115 | [design](openspec/changes/p32-world-scaling/design.md) · [tasks](openspec/changes/p32-world-scaling/tasks.md)                                 |
| **P33**   | [`p33-observability-and-operations`](openspec/changes/p33-observability-and-operations/proposal.md)   | Наблюдаемость и эксплуатация          |       4 |        38 |       114 |      15 |       120 | [design](openspec/changes/p33-observability-and-operations/design.md) · [tasks](openspec/changes/p33-observability-and-operations/tasks.md)   |
| **P34**   | [`p34-client-platform-quality`](openspec/changes/p34-client-platform-quality/proposal.md)             | Качество клиентской платформы         |       4 |        40 |       100 |      15 |       117 | [design](openspec/changes/p34-client-platform-quality/design.md) · [tasks](openspec/changes/p34-client-platform-quality/tasks.md)             |
| **P35**   | [`p35-load-and-acceptance-testing`](openspec/changes/p35-load-and-acceptance-testing/proposal.md)     | Нагрузочная и приёмочная валидация    |       3 |        36 |       108 |      15 |       119 | [design](openspec/changes/p35-load-and-acceptance-testing/design.md) · [tasks](openspec/changes/p35-load-and-acceptance-testing/tasks.md)     |
| **P36**   | [`p36-beta-and-launch`](openspec/changes/p36-beta-and-launch/proposal.md)                             | Бета и запуск                         |       4 |        36 |       108 |      15 |       118 | [design](openspec/changes/p36-beta-and-launch/design.md) · [tasks](openspec/changes/p36-beta-and-launch/tasks.md)                             |
| **Итого** | **37 фаз**                                                                                            | **M0 — M5 (от монорепо до запуска)**  | **165** | **1 458** | **3 464** | **592** | **4 327** | `openspec validate --all --strict`                                                                                                            |

## Правовая политика в отношении ассетов (ADR-002)

Репозиторий **не содержит и не распространяет** проприетарные файлы или ассеты Electronic Arts / Broadsword Online Games (Ultima Online). Проект спроектирован по модели **BYOC (Bring Your Own Client)**:

- игрок локально подключает собственные файлы установленного клиента UO Classic в браузере (разбор в Web Worker → локальный кэш OPFS без отправки на сервер);
- разработка, CI и автотесты полностью работают на процедурно генерируемом синтетическом мире и CC0-заглушках (`P02`).
