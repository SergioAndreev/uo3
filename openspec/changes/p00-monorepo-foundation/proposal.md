# Proposal: P00 Фундамент монорепозитория

## Why

Проект UO3 состоит из 6 приложений (`apps/*`) и 9 общих пакетов (`packages/*`), которые разрабатываются поэтапно (фазы P00–P36) людьми и ИИ-агентами на едином стеке TypeScript/Node 22/pnpm/Turborepo. Без воспроизводимого фундамента монорепозитория, жёстких границ импорта между клиентским и серверным кодом, локального инфраструктурного стенда, автоматизированного CI и контроля качества/конфигурации каждая последующая фаза будет тратить время на ручную настройку окружения, порождать дрейф конфигураций, утечки серверного кода в браузерный бандл и юридические риски попадания проприетарных ассетов Ultima Online в репозиторий.

Фаза **P00 (`p00-monorepo-foundation`)** открывает веху **M0 «Фундамент» (P00–P03)** и является единственной корневой фазой дорожной карты без входных зависимостей. Её цель — обеспечить репозиторий, в котором любой разработчик или ИИ-агент за ≤ 10 минут разворачивает локальное окружение целиком (БД, кэш, шина событий, стек наблюдаемости), проходит локальные проверки и получает зелёный CI на Pull Request.

## What Changes

- **Структура монорепозитория и контроль границ (`platform/monorepo-workspace`)**:
  - Инициализация workspace на `pnpm` 9 + `Turborepo` 2 + `Node.js` 22 LTS (ESM, TypeScript 5 strict) с каркасами всех 6 приложений (`apps/client`, `apps/api`, `apps/game-server`, `apps/admin`, `apps/asset-tool`, `apps/bot-client`) и 9 пакетов (`packages/domain`, `packages/rules`, `packages/protocol`, `packages/uo-formats`, `packages/content`, `packages/db`, `packages/ui-kit`, `packages/config`, `packages/test-kit`).
  - Фиксация направленного ациклического графа зависимостей (DAG) и машинно-проверяемых правил импорта (изоляция браузерного и серверного кода, изоморфность `domain`/`rules`/`protocol`/`uo-formats`, запрет импорта `@uo3/test-kit` в production-код, запрет циклических зависимостей и обратного импорта из `apps/*`).
  - Единые наследуемые пресеты TypeScript, ESLint (flat config), Prettier и Vitest в `packages/config`, единый каталог корневых скриптов (`lint`, `typecheck`, `test`, `build`, `format:check`, `check:boundaries`).
- **Локальное окружение разработки (`platform/local-dev-environment`)**:
  - Композиция Docker Compose с профилями (`core` и `observability`): PostgreSQL 17, Valkey 8, NATS JetStream 2.10+, OpenTelemetry Collector, Prometheus, Loki, Tempo и Grafana с преднастроенными источниками данных, healthcheck-пробами и детерминированными портами.
  - Идемпотентные скрипты `bootstrap` (проверка пререквизитов, установка зависимостей, генерация `.env` из шаблонов, поднятие контейнеров, ожидание готовности, прогон миграций и сидов) и `seed` (наполнение базовых метаданных среды и детерминированных фикстур), плюс команды сброса (`env:reset`) и диагностики (`doctor`).
- **Конвейер непрерывной интеграции (`platform/ci-pipeline`)**:
  - Workflow GitHub Actions с матрицей проверок `lint`, `typecheck`, `test`, `build`, `quality-gates` на PR и `main`, фильтрацией затронутых пакетов и кэшированием pnpm store и Turborepo.
  - Публикация артефактов CI (отчёты покрытия, JUnit/тест-отчёты, бандл-статистика), строгий контроль минимальных прав `GITHUB_TOKEN`, пиннинг версий экшенов по полным SHA, отмена устаревших запусков (`concurrency`) и спецификация обязательных проверок защиты ветки `main`.
- **Ворота качества кода и правовой чистоты (`platform/code-quality-gates`)**:
  - Пороги покрытия тестами по слоям монорепозитория (повышенные требования к ядру и общим пакетам), линтинг коммитов Conventional Commits (локальные git-хуки и проверка в CI), версионирование и генерация changelog через Changesets, автоматизированное обновление зависимостей через Renovate.
  - Автоматическая проверка лицензий зависимостей по белому списку SPDX и аудит уязвимостей (блокировка `critical`/`high`).
  - Автоматический гейт запрета проприетарных ассетов EA/Broadsword (ADR-002): блокировка бинарных форматов клиента UO (`.mul`, `.uop`, `.idx`, `.def`, `.enu` и др.), превышения лимита размера бинарных файлов и незадекларированных бинарных ассетов без маркера происхождения CC0/synthetic.
- **Типизированное управление конфигурацией и секретами (`platform/configuration-management`)**:
  - Схемы валидации конфигурации в `packages/config` с fail-fast проверкой на старте каждого приложения, детерминированным приоритетом источников, строгим разделением серверных и клиентских (`VITE_*`) переменных, автоматическим редактированием секретов в логах/ошибках и защитой от утечки секретов в клиентский бандл.
  - Шаблоны `.env.example` с документацией всех переменных и автоматическая проверка синхронности схем и шаблонов в CI.

## Capabilities

### New Capabilities
- `platform/monorepo-workspace`: структура `apps/*` и `packages/*`, граф зависимостей, правила импорта, общие конфиги TypeScript/ESLint/Prettier/Vitest и оркестрация задач Turborepo.
- `platform/local-dev-environment`: локальная инфраструктура Docker Compose (PostgreSQL 17, Valkey 8, NATS JetStream, Grafana/Prometheus/Loki/Tempo/OTel), скрипты `bootstrap`, `seed`, `doctor` и сброс состояния.
- `platform/ci-pipeline`: конвейер GitHub Actions для PR и основной ветки (lint, typecheck, test, build, quality-gates), кэш Turborepo и pnpm, артефакты сборок и политика обязательных проверок.
- `platform/code-quality-gates`: пороги покрытия тестами, Conventional Commits, Changesets, конфигурация Renovate, контроль лицензий и уязвимостей зависимостей, запрет проприетарных ассетов UO в репозитории.
- `platform/configuration-management`: типизированная загрузка и fail-fast валидация конфигурации и секретов для всех приложений, разделение серверного и клиентского контекстов, маскирование секретов.

### Modified Capabilities
Нет — новая фаза.

## Impact

- **Затрагиваемые приложения (`apps/*`)**: создаются минимальные собираемые и тестируемые каркасы (с загрузкой конфигурации, smoke-тестами и проверкой границ импорта) для `apps/client`, `apps/api`, `apps/game-server`, `apps/admin`, `apps/asset-tool`, `apps/bot-client`.
- **Затрагиваемые пакеты (`packages/*`)**: полная реализация инженерной инфраструктуры в `packages/config` (конфиги инструментов + модуль загрузки env) и минимальный коннектор/раннер миграций в `packages/db`; создаются собираемые каркасы с зафиксированными границами экспорта для `packages/domain`, `packages/rules`, `packages/protocol`, `packages/uo-formats`, `packages/content`, `packages/ui-kit`, `packages/test-kit`.
- **Корневая инфраструктура репозитория**: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc`, `.nvmrc`, `docker-compose.yml`, `infra/local/*`, `.github/workflows/*`, `.changeset/*`, `renovate.json`, `scripts/*`.
- **Внешние зависимости и инструменты**: Node.js 22 LTS, Corepack / pnpm 9, Turborepo 2, TypeScript 5, ESLint 9 (flat config), Prettier 3, Vitest 3, TypeBox (валидация конфигов в соответствии со стеком ADR), Docker Engine + Docker Compose v2, образы PostgreSQL 17, Valkey 8, NATS 2.10+, Grafana/Prometheus/Loki/Tempo/OTel Collector.
- **Входные зависимости**: отсутствуют (корневая фаза P00).
- **Разблокирует**:
  - Напрямую разблокирует **P01 (`p01-shared-domain-model`)**, предоставляя пакеты `packages/domain`, `packages/rules`, `packages/test-kit`, тестовый раннер и CI-пайплайн.
  - Транзитивно обеспечивает фундамент, локальный стенд, конфигурацию и ворота качества для всех фаз вех **M0–M5 (P01–P36)**.

### Вне скоупа
- Доменные типы сущностей (`Serial`, `Point3D`, `Direction`, перечисления), формулы правил UO:R, профиль эпохи и детерминированные часы/RNG — реализуются в **P01 (`p01-shared-domain-model`)**.
- Парсеры бинарных форматов UO (MUL/UOP/IDX), генератор синтетического мира и CC0-пак заглушек, CLI `apps/asset-tool` — реализуются в **P02 (`p02-uo-asset-formats-and-import`)**.
- Таблицы БД аккаунтов, персонажей, шардов, аутентификация JWT/argon2id/OAuth и реальные REST-эндпоинты `apps/api` — реализуются в **P04 (`p04-identity-and-accounts`)** и **P05 (`p05-shards-and-characters`)**.
- Реалтайм-комнаты Colyseus (`WorldPartitionRoom`, `ShardHubRoom`), игровой цикл 20 Гц, симуляционный харнес — реализуются в **P06 (`p06-game-server-runtime`)**.
- Таблицы сущностей мира, dirty-tracking, инкрементальный flush каждые 60 с, item ledger, бэкапы и PITR — реализуются в **P08 (`p08-world-persistence`)**.
- Полноценная оболочка клиента React/PWA, маршрутизация экранов и Three.js-рендерер — реализуются в **P09 (`p09-client-shell`)** и **P10 (`p10-world-renderer`)**.
- Валидация игровых YAML-определений контента (существа, предметы, рецепты, регионы) по JSON Schema в CI — реализуется в **P30 (`p30-content-pipeline`)**.
- Runtime-защита приложения (CSP, SRI, rate-limiting API, антидюп, fuzzing протокола) — реализуется в **P31 (`p31-security-and-anti-cheat`)**.
- Продакшен-оркестрация (Kubernetes, Helm-чарты, продакшен-секреты Vault/ExternalSecrets, боевые дашборды, алерты, ранбуки, релизный CD-пайплайн) — реализуется в **P33 (`p33-observability-and-operations`)**.
- Нагрузочное тестирование k6, headless-боты `apps/bot-client` и приёмочные прогоны вех — реализуются в **P35 (`p35-load-and-acceptance-testing`)**.
