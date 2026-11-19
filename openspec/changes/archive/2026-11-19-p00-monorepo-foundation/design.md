# Design: P00 Фундамент монорепозитория

## Context

Фаза **P00 (`p00-monorepo-foundation`)** создаёт технический фундамент монорепозитория UO3, на котором будут строиться все последующие 36 фаз дорожной карты (мотивация и состав capabilities — см. [proposal.md](proposal.md)).

Ключевые архитектурные ограничения из [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md):
- Зафиксированный стек: **Node.js 22 LTS**, **TypeScript 5.x (strict, ESM)**, **pnpm 9 + Turborepo 2**, **React 19 + Vite 6 + Three.js**, **NestJS 11 + Colyseus 0.16**, **TypeBox**, **PostgreSQL 17 + Drizzle ORM**, **Valkey 8**, **NATS JetStream 2.10+**, **Vitest**, **OpenTelemetry + Grafana-стек**, **GitHub Actions**.
- Правовая модель **ADR-002 («принеси свой клиент»)**: в репозитории категорически запрещены проприетарные файлы клиента Ultima Online (EA/Broadsword); для разработки и CI используются синтетические и CC0-ассеты.
- **ADR-001** требует строгого контроля графа зависимостей пакетов и изоляции клиентского и серверного кода.
- **ADR-013** ориентирует репозиторий на итеративную реализацию ИИ-агентами по циклу OpenSpec: каждая команда, проверка, диагностика и ошибка должны быть детерминированными, самодокументируемыми и воспроизводимыми за ≤ 10 минут.

---

## Goals / Non-Goals

**Goals:**
- Спроектировать полную топологию монорепозитория (6 приложений `apps/*`, 9 пакетов `packages/*`, общие конфиги, скрипты, инфраструктура) с нулевыми циклическими зависимостями и машинно-проверяемыми границами слоёв.
- Обеспечить единую типизированную систему конфигурации и секретов (`packages/config`) на базе TypeBox для серверных, клиентских и CLI-приложений с fail-fast валидацией, `*_FILE`-секретами и автоматическим редактированием.
- Создать воспроизводимый локальный стенд Docker Compose (`core` + `observability`) с изоляцией БД разработки и тестов и однокомандным идемпотентным `bootstrap`.
- Построить защищённый, быстрый, инкрементальный CI-конвейер GitHub Actions с единой точкой защиты ветки `ci-required`, кэшированием и полным набором ворот качества и правовой чистоты.
- Создать минимальные собираемые, тестируемые и проверяемые на health/readiness каркасы всех 15 рабочих единиц, готовые для немедленного старта P01.

**Non-Goals:**
- Бизнес-логика доменной модели (`Serial`, `Point3D`, формулы UO:R, часы/RNG) — **P01**.
- Парсеры бинарных форматов UO и генерация синтетического мира — **P02**.
- Прикладные таблицы БД (аккаунты, персонажи, сущности мира, item ledger) — **P04, P05, P08**.
- Игровые комнаты Colyseus (`WorldPartitionRoom`, `ShardHubRoom`) и симуляция 20 Гц — **P06**.
- Боевая оркестрация Kubernetes/Helm, продакшен-секреты Vault и боевые дашборды/алерты — **P33**.
- Валидация YAML-контента игры — **P30**; runtime античит/CSP/rate-limiting — **P31**.

---

## Decisions

### Decision 1: Монорепозиторий pnpm 9 (Corepack + Catalog) + Turborepo 2 + строгий ESM + `tsc --build`
- **Выбор:** Рабочее пространство управляется `pnpm` 9 (зафиксирован в `packageManager` через Corepack) с использованием `pnpm-workspace.yaml` и `catalog:` для выравнивания общих версий ключевых зависимостей (`typescript`, `vitest`, `@sinclair/typebox`, `eslint`, `prettier`, `tsx`). Все пакеты и приложения используют `"type": "module"`. Внутренние пакеты собираются компилятором `tsc --build` в `dist/` с `declaration: true` и `declarationMap: true`, экспортируясь через явное поле `"exports"` в `package.json`. Оркестрация задач выполняется `Turborepo 2` (`turbo.json`).
- **Обоснование:** `pnpm catalog:` устраняет дрейф версий между 15 пакетами; `tsc --build` с `declarationMap` гарантирует корректное разрешение ESM в Node 22, поддержку Go-to-Definition в IDE и полную совместимость с NestJS (`emitDecoratorMetadata` включается **только** в профиле `tsconfig.nestjs.json` для `apps/api` и `apps/game-server`, не загрязняя чистые пакеты). Turborepo обеспечивает топологический порядок (`"dependsOn": ["^build"]`) и кэширование за < 5 с на повторном прогоне.
- **Отвергнутые альтернативы:**
  - *Nx* — отклонён согласно ADR-001 из-за избыточной абстракции, плагинной «магии» и высокой стоимости сопровождения.
  - *Прямой импорт сырых `.ts` исходников между пакетами без сборки* — создаёт хрупкость в Node 22 ESM, ломает совместимость декораторов NestJS и замедляет typecheck при росте до 36 фаз.
  - *npm/yarn workspaces* — уступают pnpm по строгости изоляции зависимостей (нет фантомных импортов — phantom dependencies) и скорости установки в CI.
- **Соответствие ADR:** ADR-001.

### Decision 2: Двухуровневый контроль архитектурных границ (ESLint + dependency-cruiser + валидатор манифестов)
- **Выбор:** Границы слоёв и запреты импорта проверяются тремя взаимодополняющими слоями:
  1. `eslint-plugin-boundaries` + `no-restricted-imports` (в ESLint 9 flat config) — мгновенная обратная связь в IDE и на уровне каждого файла.
  2. `dependency-cruiser` (`.dependency-cruiser.mjs`) — полный транзитивный граф зависимостей всего монорепозитория: детекция циклов любой длины (`circular`), запрет импорта Node built-ins в браузер/изоморфное ядро, запрет импорта `apps/*` из любого другого модуля, запрет `@uo3/test-kit` вне тестовых путей.
  3. `scripts/check-workspace-manifests.ts` — проверка `package.json` всех 15 модулей (область `@uo3/*`, `protocol workspace:*`, у `@uo3/domain` единственная внешняя runtime-зависимость — `@sinclair/typebox`, нахождение `@uo3/test-kit` исключительно в `devDependencies`, синхронность `engines.node`).
- **Обоснование:** ESLint не видит многозвенных циклов между файлами/пакетами и не инспектирует `package.json`. Комбинация трёх проверок закрывает все классы архитектурной эрозии и выполняется за ≤ 5 с.
- **Отвергнутые альтернативы:**
  - *Только ESLint* — пропускает транзитивные циклы и неправильное размещение зависимостей в `dependencies` вместо `devDependencies`.
  - *Только ревью кода* — неприемлемо для параллельной разработки ИИ-агентами (ADR-013).
- **Соответствие ADR:** ADR-001, ADR-013.

### Decision 3: Типизированная конфигурация на TypeBox в `packages/config` с раздельными точками входа
- **Выбор:** Модуль загрузки и валидации конфигурации в `packages/config` строится на `@sinclair/typebox` + `TypeCompiler` и разделён на три явных subpath-экспорта:
  - `@uo3/config/env/shared` — общие примитивы, типы ошибок, редуктор секретов, `deepFreeze`.
  - `@uo3/config/env/server` — загрузка `.env*` (только вне `production`), разрешение файловых секретов `*_FILE`, серверные схемы (`ApiEnvSchema`, `GameServerEnvSchema`, `AssetToolEnvSchema`, `BotClientEnvSchema`, `DbEnvSchema`), проверки `production`-инвариантов.
  - `@uo3/config/env/client` — браузерный валидатор (без `node:fs`/`node:path`), принимающий строго `VITE_*` переменные (`ClientEnvSchema`, `AdminEnvSchema`) и запрещающий любые поля с метаданным `x-secret: true`.
- **Обоснование:** TypeBox уже закреплён в стеке ADR для протокола (`packages/protocol`). Использование TypeBox для конфигов даёт: (а) нулевое дублирование библиотек валидации, (б) стандартную JSON Schema для автоматической сверки/генерации `.env.example` (`check:env`), (в) явную аннотацию секретов через кастомные ключевые слова схемы (`x-secret`, `x-sensitive-uri`), (г) строгую изоляцию браузерного кода от Node API.
- **Отвергнутые альтернативы:**
  - *`@nestjs/config` + `Joi`* — привязывает конфигурацию к NestJS, непригодно для Vite-клиента, `asset-tool` и `bot-client`.
  - *`zod` / `valibot`* — вносит вторую конкурирующую библиотеку схем рядом с TypeBox.
  - *Чтение `process.env` напрямую в сервисах* — не гарантирует fail-fast, провоцирует опечатки и утечки секретов в логи.
- **Соответствие ADR:** Технологический стек (TypeBox), ADR-001, ADR-012.

### Decision 4: Локальный стек Docker Compose v2 с профилями `core` и `observability` и разделением БД `uo3_dev` / `uo3_test`
- **Выбор:** Единый `docker-compose.yml` с двумя профилями: `core` (PostgreSQL 17, Valkey 8, NATS 2.10+ с JetStream) и `observability` (OpenTelemetry Collector, Prometheus, Loki, Tempo, Grafana с автопровижинингом datasources и базового дашборда). Все версии образов жёстко зафиксированы (без `:latest`). Инициализационный SQL-скрипт PostgreSQL (`infra/local/postgres/init-dbs.sql`) создаёт две изолированные БД: `uo3_dev` и `uo3_test`. Все хостовые порты параметризованы через переменные (`PG_PORT`, `VALKEY_PORT`, `NATS_PORT`, `NATS_MONITOR_PORT`, `GRAFANA_PORT` и т.д.).
- **Обоснование:** Профиль `core` потребляет < 512 МБ ОЗУ и стартует за ~15–30 с, что критично для ноутбуков и CI/агентских сред; профиль `observability` включается флагом при отладке метрик, логов и трейсов. Отдельная база `uo3_test` исключает повреждение состояния разработчика при прогоне интеграционных тестов. Выбор Valkey 8 вместо Redis полностью соответствует стеку ADR и лицензионной политике SPDX (BSD-3-Clause против SSPL).
- **Отвергнутые альтернативы:**
  - *Единый профиль со всей Grafana по умолчанию* — лишний расход ~1.5–2 ГБ ОЗУ на каждый базовый `bootstrap`.
  - *Testcontainers без Docker Compose* — неудобно для интерактивной локальной разработки и ручной инспекции БД/Grafana.
  - *Одна БД для dev и test* — приводит к постоянной потере локальных данных разработчика при запуске `pnpm test`.
- **Соответствие ADR:** Стек (PostgreSQL 17, Valkey 8, NATS JetStream, Grafana-стек), ADR-011.

### Decision 5: Единый тестовый раннер Vitest 3 с проектным разделением unit/integration и послойными порогами покрытия
- **Выбор:** Корневой `vitest.workspace.ts` и два общих пресета в `packages/config` (`@uo3/config/vitest/node` и `@uo3/config/vitest/browser`) на базе Vitest 3 + `@vitest/coverage-v8`. Тесты делятся на `*.test.ts` (быстрые модульные без внешней инфраструктуры) и `*.integration.test.ts` (работающие против `uo3_test`, Valkey и NATS). Пороги покрытия закреплены по слоям: `85%` lines/statements и `80%` branches для ядра (`domain`, `rules`, `protocol`, `config`), `70%` / `65%` для остальных runtime-пакетов и приложений.
- **Обоснование:** Единый движок с нативной поддержкой ESM, TypeScript и JUnit/LCOV-репортеров экономит когнитивную и конфигурационную сложность по сравнению со связкой Jest + Vitest. Разделение unit и integration позволяет быстро гонять модульные тесты без поднятия Docker.
- **Отвергнутые альтернативы:**
  - *Jest для NestJS + Vitest для React* — дублирование конфигов, моков и форматов покрытия; исторические проблемы Jest с нативным ESM в Node 22.
  - *Единый низкий порог покрытия (50%)* — не защищает критическую логику формул и валидации конфигурации от регрессий.
- **Соответствие ADR:** ADR-011.

### Decision 6: Агрегирующий гейт `ci-required`, инкрементальный фильтр affected и SHA-пиннинг GitHub Actions
- **Выбор:** Основной workflow `.github/workflows/ci.yml` строится по схеме fan-out / fan-in:
  1. `detect-changes` определяет, затронуты ли корневые файлы (`package.json`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.github/workflows/**`, `packages/config/**`) или ветка `main`; при их изменении запускается полный прогон, иначе — `turbo run --filter=...[<base-sha>]`.
  2. Параллельные джобы: `lint`, `typecheck`, `test` (с сервисными контейнерами PG 17, Valkey 8, NATS 2.10+), `build`, `quality-gates`.
  3. Финальный джоб `ci-required` (`if: always()`, проверяющий `needs.*.result == 'success'`) — единственная обязательная проверка в `.github/rulesets/main.json`.
  4. Все сторонние Actions зафиксированы по 40-символьному SHA; на верхнем уровне `permissions: { contents: read }`; удалённый кэш Turborepo подключается условно при наличии секрета `TURBO_TOKEN` с безопасным fallback на `actions/cache` (в т.ч. для fork PR).
- **Обоснование:** Единый агрегатор `ci-required` позволяет добавлять новые стадии в будущих фазах (например, Playwright в P09/P10, валидацию YAML-контента в P30) без перенастройки GitHub Branch Protection и без проблемы вечно висящих `skipped`-проверок. SHA-пиннинг минимизирует риск компрометации тегов сторонних Actions.
- **Отвергнутые альтернативы:**
  - *Последовательный один джоб на весь CI* — увеличивает время отклика PR в 3–4 раза и скрывает последующие ошибки при раннем падении.
  - *Обязательный статус на каждый отдельный job* — ломается при пропуске незатронутых шагов и усложняет эволюцию пайплайна.
- **Соответствие ADR:** ADR-001, ADR-011, ADR-012.

### Decision 7: Автоматический гейт проприетарных ассетов UO с проверкой сигнатур и реестром CC0/synthetic
- **Выбор:** Скрипт `scripts/check-assets.ts`, запускаемый в `pre-commit` (на staged-файлах) и в CI `quality-gates` (на всём дереве git), применяет 4 каскадные проверки:
  1. Блокировка путей и расширений UO (`.mul`, `.uop`, `.idx`, `.def`, `.enu`, `tiledata.*`, `verdata.*`, `hues.*`, `cliloc.*`, `anim*`, `art*`, `map*.mul`, `statics*.mul`, `staidx*.mul`, `multi.*`, `gumpart.*`, `texmaps.*`, `radarcol.*`, `sound*.mul`); шаблоны имён (без явного UO-расширения) не применяются к исходникам и документации (`.ts`, `.tsx`, `.js`, `.mjs`, `.json`, `.md`, `.yaml`), чтобы не блокировать, например, `tiledata.ts` или `map-patch.ts`.
  2. Проверка магических байтов первых 16 байт любого бинарного файла (в т.ч. сигнатура UOP `4D 59 50 00` — `MYP\0`), блокирующая переименованные архивы UO.
  3. Жёсткий лимит размера `512` КиБ на любой бинарный файл в git.
  4. Обязательная регистрация каждого бинарного медиа/ассета в `assets/ASSET_MANIFEST.json` с полями `path`, `sha256`, `license` (`CC0-1.0` | `synthetic-generated`), `source`, `addedInPhase`.
- **Обоснование:** Технически гарантирует исполнение ADR-002 даже при случайной ошибке разработчика или попытке переименовать файл. Создаёт готовый контракт для P02 (`assets/synthetic-dev-world`), куда будут добавлены CC0-заглушки.
- **Отвергнутые альтернативы:**
  - *Только `.gitignore`* — легко обходится командой `git add -f` и не проверяет переименованные бинарники.
  - *Git LFS* — не решает юридический запрет хранения чужой IP в репозитории.
- **Соответствие ADR:** ADR-002.

### Decision 8: Контроль цепочки поставок, лицензий SPDX и временных исключений уязвимостей
- **Выбор:**
  - В корневом `package.json` включается строгая политика `pnpm.onlyBuiltDependencies` (выполняются lifecycle-скрипты только явно разрешённых пакетов, таких как `esbuild`, `@swc/core` при необходимости; остальные сторонние `postinstall` блокируются).
  - `scripts/check-licenses.ts` парсит полное дерево разрешённых зависимостей (`pnpm licenses list --json`) и сверяет SPDX-идентификаторы с `config/security/licenses.policy.json` (белый список пермиссивных лицензий + опциональные аудированные исключения).
  - `scripts/check-audit.ts` запускает `pnpm audit --prod --json` и блокирует любые `high`/`critical` уязвимости, не покрытые активным временным waiver в `config/security/audit-waivers.json` с обязательной датой истечения `expiresAt` ≤ `30` дней.
  - `renovate.json` группирует обновления по экосистемам, включает `minimumReleaseAge: "3 days"` для защиты от свежих атак на npm-реестр (при немедленном выпуске `vulnerabilityAlerts`), пиннит дайджесты Docker и SHA Actions, ограничивает `prConcurrentLimit: 5`.
- **Обоснование:** Раннее внедрение политики цепочки поставок предотвращает накопление вирусных лицензий (GPL/AGPL/SSPL) и уязвимых пакетов ещё до появления тяжёлых зависимостей в P04–P10.
- **Отвергнутые альтернативы:**
  - *Ручной аудит раз в релиз* — не масштабируется и приводит к болезненной замене глубоко интегрированных библиотек.
  - *Бессрочные ignore-списки CVE* — превращают аудит в формальность.
- **Соответствие ADR:** ADR-012.

### Decision 9: Операционные скрипты жизненного цикла на TypeScript (`scripts/*.ts`) с минимальной POSIX-обёрткой
- **Выбор:** Логика `bootstrap`, `doctor`, `env:reset`, `check:assets`, `check:licenses`, `check:audit`, `check:env`, `check:workspace-manifests`, `check:ci-integrity` реализуется на TypeScript в `scripts/` и запускается через `tsx`. Единственный shell-скрипт — тонкий POSIX-префлайт `scripts/bootstrap.sh` (проверка наличия `node` 22, `corepack`/`pnpm` 9, установка зависимостей и передача управления `pnpm tsx scripts/bootstrap.ts`).
- **Обоснование:** Скрипты покрываются модульными тестами в Vitest, переиспользуют парсеры из `@uo3/config` и работают одинаково на Linux, macOS и WSL2 без расхождений GNU/BSD утилит.
- **Отвергнутые альтернативы:**
  - *Объёмные bash-скрипты* — сложны в тестировании, хрупки при работе с JSON/YAML и склонны к платформа-зависимым багам.
- **Соответствие ADR:** ADR-011, ADR-013.

---

## Architecture & Contracts

### 1. Структура монорепозитория и граф зависимостей (DAG)

```mermaid
flowchart TD
  subgraph L5["Слой 5: Приложения (листовые, импорт из них запрещён)"]
    CLIENT["apps/client (React + Three.js, Browser)"]
    ADMIN["apps/admin (React, Browser)"]
    API["apps/api (NestJS 11, Server)"]
    GS["apps/game-server (NestJS + Colyseus, Server)"]
    ATOOL["apps/asset-tool (Node CLI)"]
    BOT["apps/bot-client (Headless Node)"]
  end

  subgraph L4["Слой 4: Только devDependencies и тесты"]
    TK["packages/test-kit (dev-only)"]
  end

  subgraph L3["Слой 3: Платформенные пакеты"]
    UI["packages/ui-kit (Browser/React)"]
    DB["packages/db (Server/PostgreSQL)"]
  end

  subgraph L2["Слой 2: Изоморфные расширения"]
    RULES["packages/rules (Isomorphic)"]
    PROTO["packages/protocol (Isomorphic)"]
    UOF["packages/uo-formats (Isomorphic)"]
    CONT["packages/content (Isomorphic)"]
  end

  subgraph L1["Слой 1: Чистое ядро (только @sinclair/typebox)"]
    DOM["packages/domain (Pure TS)"]
  end

  subgraph L0["Слой 0: Конфигурация и тулинг"]
    CFG_C["packages/config (/env/client, /env/shared)"]
    CFG_S["packages/config (/env/server, /env/shared)"]
  end

  CLIENT --> UI & RULES & PROTO & UOF & CONT & DOM & CFG_C
  ADMIN --> UI & PROTO & CONT & DOM & CFG_C
  API --> DB & RULES & PROTO & CONT & DOM & CFG_S
  GS --> DB & RULES & PROTO & UOF & CONT & DOM & CFG_S
  ATOOL --> UOF & CONT & DOM & CFG_S
  BOT --> RULES & PROTO & DOM & CFG_S

  UI --> PROTO & DOM & CFG_C
  DB --> DOM & CFG_S

  CONT --> RULES & DOM
  RULES --> DOM
  PROTO --> DOM
  UOF --> DOM

  TK -. "devDependencies only" .-> RULES & PROTO & UOF & CONT & DOM & CFG_S
```

#### Матрица разрешённых и запрещённых зависимостей

| Модуль | Платформа | Разрешённые runtime `@uo3/*` | Явно запрещено |
|---|---|---|---|
| `@uo3/config` | Split (`shared`, `server`, `client`) | — | Любые `@uo3/*`; `node:*` в `/env/client` и `/env/shared` |
| `@uo3/domain` | Isomorphic (Pure) | — (из внешних runtime deps — только `@sinclair/typebox`) | Любые `@uo3/*`, `node:*`, DOM (`window`, `document`), прочие внешние `dependencies` |
| `@uo3/rules` | Isomorphic | `@uo3/domain` | `@uo3/db`, `@uo3/ui-kit`, `node:*`, DOM |
| `@uo3/protocol` | Isomorphic | `@uo3/domain` | `@uo3/db`, `@uo3/ui-kit`, `node:*`, DOM |
| `@uo3/uo-formats` | Isomorphic | `@uo3/domain` | `@uo3/db`, `@uo3/ui-kit`, `node:fs`/`node:net`, DOM |
| `@uo3/content` | Isomorphic | `@uo3/domain`, `@uo3/rules` | `@uo3/db`, `@uo3/ui-kit`, `node:fs` в корневом экспорте |
| `@uo3/db` | Server-only | `@uo3/domain`, `@uo3/config` | `@uo3/ui-kit`, `react`, `three` |
| `@uo3/ui-kit` | Browser-only | `@uo3/domain`, `@uo3/protocol`, `@uo3/config` (client/shared) | `@uo3/db`, `@uo3/config/env/server`, `node:*`, `@nestjs/*`, `colyseus` |
| `@uo3/test-kit` | Dev/Test-only | `@uo3/domain`, `@uo3/rules`, `@uo3/protocol`, `@uo3/uo-formats`, `@uo3/content`, `@uo3/config` | Использование в production `src/` и секции `dependencies` любых модулей |
| `apps/client` | Browser | `@uo3/domain`, `@uo3/rules`, `@uo3/protocol`, `@uo3/uo-formats`, `@uo3/content`, `@uo3/ui-kit`, `@uo3/config` (client/shared) | `@uo3/db`, `@uo3/config/env/server`, `node:*`, другие `apps/*` |
| `apps/admin` | Browser | `@uo3/domain`, `@uo3/protocol`, `@uo3/content`, `@uo3/ui-kit`, `@uo3/config` (client/shared) | `@uo3/db`, `@uo3/config/env/server`, `node:*`, другие `apps/*` |
| `apps/api` | Server (NestJS 11) | `@uo3/domain`, `@uo3/rules`, `@uo3/protocol`, `@uo3/content`, `@uo3/db`, `@uo3/config` (server/shared) | `@uo3/ui-kit`, `react`, `three`, другие `apps/*` |
| `apps/game-server` | Server (NestJS + Colyseus) | `@uo3/domain`, `@uo3/rules`, `@uo3/protocol`, `@uo3/uo-formats`, `@uo3/content`, `@uo3/db`, `@uo3/config` (server/shared) | `@uo3/ui-kit`, `react`, `three`, другие `apps/*` |
| `apps/asset-tool` | Node CLI | `@uo3/domain`, `@uo3/uo-formats`, `@uo3/content`, `@uo3/config` (server/shared) | `@uo3/db`, `@uo3/ui-kit`, другие `apps/*` |
| `apps/bot-client` | Headless Node | `@uo3/domain`, `@uo3/rules`, `@uo3/protocol`, `@uo3/config` (server/shared) | `@uo3/db`, `@uo3/ui-kit`, другие `apps/*` |

---

### 2. Конкретные модули, конфиги и каркасы приложений

#### 2.1 `packages/config` (`@uo3/config`)
- **Точки входа (`package.json` `exports`):**
  - `./tsconfig/base.json`, `./tsconfig/isomorphic.json`, `./tsconfig/node.json`, `./tsconfig/nestjs.json`, `./tsconfig/react.json`
  - `./eslint/base`, `./eslint/browser`, `./eslint/server`, `./eslint/boundaries`
  - `./prettier`
  - `./vitest/node`, `./vitest/browser`
  - `./env/shared` — `ConfigError`, `ConfigErrorCode`, `deepFreeze`, `redactConfig`, `redactUri`, `parseStrictBoolean`, `parseStrictInt`, `createSecretSchema`, `createSensitiveUriSchema`
  - `./env/server` — `loadServerConfig`, `resolveSecretFiles`, `loadDotEnvFiles`, схемы `DatabaseEnvSchema`, `ValkeyEnvSchema`, `NatsEnvSchema`, `TelemetryEnvSchema`, `ApiEnvSchema`, `GameServerEnvSchema`, `AssetToolEnvSchema`, `BotClientEnvSchema`
  - `./env/client` — `loadClientConfig`, `assertClientSchemaSafe`, схемы `ClientEnvSchema`, `AdminEnvSchema`
- **Ключевые опции `tsconfig/base.json`:**
  - `target: "ES2023"`, `module: "NodeNext"`, `moduleResolution: "NodeNext"` (для Vite/React в `tsconfig/react.json` переопределяется на `module: "ESNext"`, `moduleResolution: "Bundler"`, `jsx: "react-jsx"`).
  - `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`, `noFallthroughCasesInSwitch: true`, `noPropertyAccessFromIndexSignature: true`, `verbatimModuleSyntax: true`, `isolatedModules: true`, `declaration: true`, `declarationMap: true`, `composite: true`.
  - В `tsconfig/nestjs.json` (только для `apps/api` и `apps/game-server`): `experimentalDecorators: true`, `emitDecoratorMetadata: true`, `verbatimModuleSyntax: false` (требуется для emitDecoratorMetadata в NestJS).
- **Типизированные схемы конфигурации (TypeBox):**
  - `ApiEnvSchema`: `NODE_ENV`, `LOG_LEVEL`, `API_HOST`, `API_PORT` (default `3001`), `DATABASE_URL` (`x-sensitive-uri: true`), `VALKEY_URL` (`x-sensitive-uri: true`), `NATS_URL` (`x-sensitive-uri: true`), `IDENTITY_JWT_SIGNING_KEYS_JSON` (`x-secret: true`, набор Ed25519-ключей EdDSA по ADR-009; в P00 опционален, обязательность и формат значения фиксирует P04), `CORS_ALLOWED_ORIGINS`, `CORS_ALLOW_CREDENTIALS`, `SHUTDOWN_TIMEOUT_MS` (default `15000`), `OTEL_EXPORTER_OTLP_ENDPOINT` (optional).
  - `GameServerEnvSchema`: `NODE_ENV`, `LOG_LEVEL`, `GAME_HOST`, `GAME_PORT` (default `2567`), `GAME_HEALTH_PORT` (default `2568`), `DATABASE_URL`, `VALKEY_URL`, `NATS_URL`, `SHARD_ID` (default `local-dev`), `SHUTDOWN_TIMEOUT_MS`, `OTEL_EXPORTER_OTLP_ENDPOINT`.
  - `ClientEnvSchema`: `VITE_APP_ENV`, `VITE_API_BASE_URL` (`http`/`https`), `VITE_GAME_WS_URL` (`ws`/`wss`), `VITE_ASSET_MODE` (`synthetic` | `user-folder`), `VITE_LOG_LEVEL`.
  - `AdminEnvSchema`: `VITE_APP_ENV`, `VITE_API_BASE_URL` (`http`/`https`), `VITE_LOG_LEVEL`.
  - `AssetToolEnvSchema`: `NODE_ENV`, `LOG_LEVEL`, `UO_ASSETS_INPUT_DIR` (optional), `SYNTHETIC_OUTPUT_DIR`.
  - `BotClientEnvSchema`: `NODE_ENV`, `LOG_LEVEL`, `TARGET_API_URL`, `TARGET_GAME_WS_URL`, `BOT_CONCURRENCY` (`1..5000`).
- **Коды ошибок конфигурации (`ConfigErrorCode`):**
  - `CONFIG_VALIDATION_FAILED` — нарушение типа, формата, диапазона или отсутствие обязательного поля.
  - `CONFIG_CONFLICT` — одновременно заданы `<KEY>` и `<KEY>_FILE`.
  - `CONFIG_SECRET_FILE_ERROR` — файл `<KEY>_FILE` не существует, недоступен для чтения или пуст после `trim()`.
  - `CONFIG_CLIENT_SECRET_FORBIDDEN` — схема клиентского приложения содержит поле без `VITE_` или поле с `x-secret: true`.
  - `CONFIG_INSECURE_PROD_VALUE` — в `NODE_ENV=production` обнаружен dev-плейсхолдер (`CHANGE_ME_*`, `dev-secret`, `local-only`), ключ < 32 байт или `CORS_ALLOWED_ORIGINS=*` при `CORS_ALLOW_CREDENTIALS=true`.

#### 2.2 Алгоритм загрузки и редактирования конфигурации

```mermaid
sequenceDiagram
  participant App as "Приложение (api / game-server)"
  participant Loader as "loadServerConfig (packages/config)"
  participant FS as "Файловая система (.env / *_FILE)"
  participant TB as "TypeBox TypeCompiler"
  participant Log as "Structured Logger"

  App->>Loader: "loadServerConfig(Schema, process.env)"
  alt NODE_ENV !== "production"
    Loader->>FS: "Чтение .env -> .env.local -> .env.<NODE_ENV>.local"
  else NODE_ENV === "production"
    Note over Loader: "Автозагрузка .env отключена"
  end
  loop Для каждого поля с x-secret или x-sensitive-uri
    alt Заданы и KEY, и KEY_FILE
      Loader-->>App: "Накопить ошибку CONFIG_CONFLICT"
    else Задан только KEY_FILE
      Loader->>FS: "readFileSync(path, utf8).replace(/[\\r\\n]+$/, '')"
      alt Ошибка чтения или пустое значение
        Loader-->>App: "Накопить ошибку CONFIG_SECRET_FILE_ERROR"
      end
    end
  end
  Loader->>Loader: "Строгое приведение типов (int, bool 1/0/true/false, URL)"
  Loader->>TB: "Проверка всех ограничений схемы + prod-инвариантов"
  alt Есть хотя бы 1 ошибка
    Loader->>Log: "Вывод полного списка ошибок (секреты заменены на [REDACTED])"
    Loader-->>App: "process.exit(78)"
  else Валидация пройдена
    Loader->>Loader: "deepFreeze(config)"
    Loader->>Log: "Печать redactConfig(config) на старте"
    Loader-->>App: "Неизменяемый типизированный объект Config"
  end
```

**Правила редактирования (`redactConfig`):**
- Поля с `x-secret: true` → всегда заменяются на `"[REDACTED]"`.
- Поля с `x-sensitive-uri: true` → парсятся через `new URL(value)`: если присутствует `url.password`, он заменяется на `"[REDACTED]"` с сохранением `protocol`, `username`, `hostname`, `port`, `pathname` (например, `postgresql://uo3:[REDACTED]@localhost:5432/uo3_dev`). Если строка невалидна как URL (например, на шаге вывода ошибки валидации), возвращается `"[REDACTED_INVALID_URI]"`, чтобы сырой пароль никогда не попал в stderr.

#### 2.3 `packages/db` (`@uo3/db`) — модель данных и инфраструктура миграций P00

В P00 `packages/db` создаёт фундамент подключения Drizzle ORM к PostgreSQL 17, раннер миграций (`drizzle-kit`), проверку здоровья (`checkDbHealth`) и **единственную платформенную таблицу метаданных среды** (прикладные игровые таблицы создаются в P04, P05, P08):

| Таблица | Колонка | Тип PostgreSQL | Ограничения / Индексы | Назначение |
|---|---|---|---|---|
| `platform_env_metadata` | `key` | `varchar(128)` | `PRIMARY KEY` | Идентификатор параметра среды (например, `shard.default_id`, `seed.version`, `era.baseline`) |
| `platform_env_metadata` | `value` | `jsonb` | `NOT NULL` | Детерминированное JSON-значение метаданных |
| `platform_env_metadata` | `description` | `text` | `NOT NULL` | Человекочитаемое описание записи |
| `platform_env_metadata` | `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Время создания |
| `platform_env_metadata` | `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Время последнего обновления |

- **Индексы:** первичный ключ `platform_env_metadata_pkey (key)`.
- **Идемпотентный `seed` (`packages/db/src/seed.ts`):** выполняет `INSERT ... ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description` в рамках транзакции для фиксированных записей (`seed.version = "p00-v1"`, `shard.default = { id: "local-dev", name: "UO3 Local Dev", era: "uo-r" }`, `world.synthetic_ready = false`). Повторный прогон не создаёт дубликатов и не меняет число строк.
- **Учёт миграций:** стандартная таблица `drizzle.__drizzle_migrations` с SHA-256 хэшами SQL-миграций.

#### 2.4 Каркасы приложений (`apps/*`) и пакетов-заглушек (`packages/*`)

| Модуль | Минимальная архитектура в P00 | Контракт проверки |
|---|---|---|
| `apps/api` | NestJS 11 (`AppModule`, `PlatformConfigModule`, `InfraConnectionsModule` для PG/Valkey/NATS, `HealthController` с `GET /healthz` и `GET /readyz`, graceful shutdown `enableShutdownHooks`) | Unit + integration тесты `/healthz` (200), `/readyz` (200/503), fail-fast `exit 78` |
| `apps/game-server` | NestJS 11 `createApplicationContext` + Colyseus 0.16 `Server` + HTTP health server (`GET /healthz`, `GET /readyz` с проверкой PG/Valkey/NATS), graceful shutdown | Unit + integration тесты готовности и остановки зависимостей |
| `apps/client` | Vite 6 + React 19 + `loadClientConfig(import.meta.env)` + Vite-плагин проверки отсутствия секретов в бандле + рендер базового маркера из `@uo3/ui-kit` | `build` + unit-тест валидации конфига + генерация отчёта размера бандла |
| `apps/admin` | Vite 6 + React 19 + `loadClientConfig(import.meta.env)` + базовый компонент из `@uo3/ui-kit` | `build` + unit-тест конфига + отчёт размера бандла |
| `apps/asset-tool` | Node 22 CLI-каркас (`--version`, `check-env`) с `loadServerConfig(AssetToolEnvSchema)` | `build` + unit-тест CLI и конфига |
| `apps/bot-client` | Headless Node 22 каркас (`--version`, `ping-health` для проверки `/healthz` API) с `loadServerConfig(BotClientEnvSchema)` | `build` + unit-тест конфига и изоляции от `@uo3/db` |
| `packages/domain`, `rules`, `protocol`, `uo-formats`, `content`, `ui-kit`, `test-kit` | Сборные ESM-каркасы с `package.json`, `tsconfig.json`, `src/index.ts` (экспортирующий константу версии/маркер пакета `PACKAGE_ID`), и smoke-тестом `src/index.test.ts`, проходящим пороги покрытия | `lint`, `typecheck`, `test`, `build`, `check:boundaries` |

---

### 3. Локальное окружение Docker Compose (`docker-compose.yml` + `infra/local/`)

| Сервис | Профиль | Образ (зафиксированный тег) | Порт хоста (переменная / по умолчанию) | Healthcheck | Том |
|---|---|---|---|---|---|
| `postgres` | `core` | `postgres:17.2-alpine` | `${PG_PORT:-5432}:5432` | `pg_isready -U ${PG_USER:-uo3} -d uo3_dev` (5s) | `uo3_pg_data` |
| `valkey` | `core` | `valkey/valkey:8.0.2-alpine` | `${VALKEY_PORT:-6379}:6379` | `valkey-cli ping` (5s) | `uo3_valkey_data` |
| `nats` | `core` | `nats:2.10.25-alpine` | `${NATS_PORT:-4222}:4222`, `${NATS_MONITOR_PORT:-8222}:8222` | `wget -qO- http://127.0.0.1:8222/healthz` (5s) | `uo3_nats_data` |
| `otel-collector` | `observability` | `otel/opentelemetry-collector-contrib:0.118.0` | `${OTEL_GRPC_PORT:-4317}:4317`, `${OTEL_HTTP_PORT:-4318}:4318` | `wget -qO- http://127.0.0.1:13133/` (10s) | — |
| `prometheus` | `observability` | `prom/prometheus:v3.1.0` | `${PROMETHEUS_PORT:-9090}:9090` | `wget -qO- http://127.0.0.1:9090/-/ready` (10s) | `uo3_prom_data` |
| `loki` | `observability` | `grafana/loki:3.3.2` | `${LOKI_PORT:-3100}:3100` | `wget -qO- http://127.0.0.1:3100/ready` (10s) | `uo3_loki_data` |
| `tempo` | `observability` | `grafana/tempo:2.7.0` | `${TEMPO_PORT:-3200}:3200` | `wget -qO- http://127.0.0.1:3200/ready` (10s) | `uo3_tempo_data` |
| `grafana` | `observability` | `grafana/grafana:11.4.0` | `${GRAFANA_PORT:-3000}:3000` | `wget -qO- http://127.0.0.1:3000/api/health` (10s) | `uo3_grafana_data` |

- **Конфигурация NATS (`infra/local/nats/nats.conf`):** `jetstream { store_dir: "/data/jetstream", max_mem: 256M, max_file: 1G }`, `http_port: 8222`.
- **Провижининг Grafana (`infra/local/grafana/provisioning/`):**
  - `datasources/datasources.yaml` — авторегистрация `Prometheus` (`http://prometheus:9090`), `Loki` (`http://loki:3100`), `Tempo` (`http://tempo:3200`) с корреляцией `tracesToLogsV2` и `derivedFields` по `traceId`.
  - `dashboards/provider.yaml` + `dashboards/uo3-local-health.json` — базовый дашборд состояния сервисов (uptime, scrape targets, объём логов, трейсы OTel).
- **Инициализация PostgreSQL (`infra/local/postgres/init-dbs.sql`):** создание `uo3_dev` и `uo3_test`, подключение расширений `pgcrypto` и `uuid-ossp` в обеих базах.
- **Защита `env:reset`:** парсинг `DATABASE_URL`, сравнение `hostname` с белым списком `["localhost", "127.0.0.1", "::1", "postgres"]`; при несовпадении — немедленный выход с кодом `1` до запуска любых SQL/Docker команд. Без флага `--yes` в неинтерактивном TTY также отказ с кодом `1`.

---

### 4. Конвейер CI (GitHub Actions) и ворота качества

```mermaid
flowchart LR
  TRIG["Push main / Pull Request / Nightly"] --> DET["detect-changes (diff & root triggers)"]
  DET --> LINT["lint (ESLint, Prettier, Boundaries, Manifests)"]
  DET --> TC["typecheck (tsc --build / turbo)"]
  DET --> TEST["test (Unit + Integration + PG17/Valkey8/NATS + Coverage)"]
  DET --> BUILD["build (Apps & Packages + Bundle Stats)"]
  DET --> QG["quality-gates (Commits, Changesets, Assets, Secrets, Licenses, Audit, Env Parity, Renovate, OpenSpec, CI SHA Check)"]

  LINT --> AGG["ci-required (Branch Protection Gate)"]
  TC --> AGG
  TEST --> AGG
  BUILD --> AGG
  QG --> AGG

  TEST -. "if: always(), 14d/30d" .-> ART1["Artifacts: JUnit + LCOV Coverage"]
  BUILD -. "if: always(), 14d/30d" .-> ART2["Artifacts: Bundle Size Reports"]
```

#### Контракт артефактов качества и политик
1. **`.github/rulesets/main.json`**: JSON-описание GitHub Repository Ruleset для `refs/heads/main`: `required_status_checks: [{ context: "ci-required" }]`, `strict_required_status_checks_policy: true`, `required_approving_review_count: 1`, `non_fast_forward: true`, `deletion: true`, `required_linear_history: true`. Скрипт `scripts/check-ci-integrity.ts` проверяет: (а) совпадение имени `ci-required` в `ci.yml` и `main.json`, (б) 40-символьный SHA на всех `uses:` в `.github/workflows/*.yml`, (в) `permissions: { contents: read }` на верхнем уровне, (г) совпадение тегов образов PG/Valkey/NATS между `docker-compose.yml` и `ci.yml`.
2. **Conventional Commits (`commitlint.config.mjs`)**: типы `feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert`, max header `100`, разрешённые scopes (все 15 коротких имён пакетов/приложений + `repo`, `ci`, `infra`, `deps`, `release`, `p00`..`p36`). Хуки через `husky` + `lint-staged` (проверка только staged файлов: Prettier, ESLint, `check:assets --staged`, `check:secrets --staged`).
3. **Changesets (`.changeset/config.json`)**: `access: "restricted"`, `baseBranch: "main"`, игнорирование приватных внутренних тестов при версионировании, скрипт проверки PR (`check:changeset`) пропускает PR, меняющие только `docs/**`, `openspec/**`, `.github/**`, `*.md`, `**/*.test.ts`, и требует файл `.changeset/*.md` (или метку `no-changeset-needed`) при изменении производственного `src/` в `apps/*` или `packages/*`.
4. **Renovate (`renovate.json`)**: `extends: ["config:recommended", "helpers:pinGitHubActionDigests"]`, `minimumReleaseAge: "3 days"`, `prConcurrentLimit: 5`, `vulnerabilityAlerts: { enabled: true, minimumReleaseAge: null }`, `packageRules` с группировкой по слоям (tooling/TS, NestJS/Colyseus, React/Three.js, Docker digests, GitHub Actions) и отделением `major`-обновлений с меткой `breaking-update`.
5. **Политика лицензий (`config/security/licenses.policy.json`)**:
   ```json
   {
     "allowedSpdx": [
       "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC",
       "0BSD", "CC0-1.0", "Unlicense", "MPL-2.0", "Zlib",
       "BlueOak-1.0.0", "Python-2.0"
     ],
     "deniedPatterns": ["GPL", "AGPL", "LGPL", "SSPL", "UNLICENSED", "UNKNOWN"],
     "exceptions": []
   }
   ```
6. **Реестр ассетов (`assets/ASSET_MANIFEST.json`)**:
   ```json
   {
     "schemaVersion": 1,
     "maxBinaryBytes": 524288,
     "assets": []
   }
   ```
   Каждая запись в `assets` (появляющаяся начиная с P02) обязана иметь поля `{ "path": "...", "sha256": "<64-hex>", "license": "CC0-1.0" | "synthetic-generated", "source": "...", "addedInPhase": "P02" }`.
7. **Проверка секретов (`scripts/check-secrets.ts` / `.gitleaks.toml`)**: детекция PEM-ключей, токенов GitHub/AWS/Discord/Google, хардкоженных паролей в URI, высокоэнтропийных строк; явный allowlist для `*.env.example` с маркером `CHANGE_ME_LOCAL_DEV_ONLY`.
8. **Валидация OpenSpec в CI**: при изменении файлов в `openspec/changes/<id>/**` CI извлекает уникальные `<id>` и выполняет `OPENSPEC_TELEMETRY=0 openspec validate <id> --strict` (не затрагивая нетронутые параллельные ветки изменений).

---

## Risks / Trade-offs

- **[Строгий ESM + декораторы NestJS (`emitDecoratorMetadata`)]** → Выделяем отдельный профиль `tsconfig.nestjs.json` исключительно для `apps/api` и `apps/game-server` (где включены `experimentalDecorators`, `emitDecoratorMetadata` и отключён `verbatimModuleSyntax`), тогда как все остальные 13 модулей компилируются в максимально чистом ESM-режиме. Дополнительно покрываем сборку обоих серверов smoke-тестом запуска.
- **[Высокие пороги покрытия (85%/80% для ядра) на ранних каркасах P00]** → Каркасы P00 содержат только минимальный тестируемый код (например, константы идентификации пакетов и реальную логику в `packages/config` и `packages/db`), поэтому пороги достигаются естественно без «пустых» тестов; сгенерированные файлы (`dist/`, `*.d.ts`) и `packages/test-kit` явно исключены из расчёта покрытия.
- **[Ложные срабатывания инкрементальной фильтрации CI (affected)]** → Любое изменение корневых файлов (`package.json`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig*`, `eslint*`, `.github/**`, `packages/config/**`, `scripts/**`) автоматически переводит CI в режим полного прогона; кроме того, `push` в `main` и ночной прогон всегда выполняют полный прогон без фильтрации.
- **[Медленный холодный старт `bootstrap` при первой загрузке Docker-образов]** → Профиль `core` содержит только 3 лёгких Alpine-образа (~180 МБ суммарно), а тяжёлый стек `observability` вынесен в отдельный опциональный профиль; `bootstrap` проверяет доступность Docker daemon за ≤ 10 с до начала скачиваний и выводит прогресс по шагам.
- **[Конфликты портов у разработчиков или при параллельных git worktrees]** → Все порты в `docker-compose.yml` и `.env.example` параметризованы переменными окружения; `doctor` и `bootstrap` проверяют занятость портов заранее и подсказывают конкретные переменные переопределения.
- **[Отказ PR из внешних форков из-за отсутствия секрета `TURBO_TOKEN`]** → Workflow проверяет наличие `TURBO_TOKEN` и подключает удалённый кэш только при его присутствии; при отсутствии используется стандартный `actions/cache` для `.turbo`, поэтому fork PR всегда работают без сбоев.
- **[Блокировка легитимных нативных пакетов из-за `onlyBuiltDependencies` в pnpm]** → Поддерживаем явный документированный список одобренных пакетов в корневом `package.json` (`esbuild`, при появлении в P04/P06 — `argon2`, `uWebSockets.js`), сопровождая каждое добавление ревью в PR.
- **[Строгие правила `check:assets` могут задеть бинарные тестовые фикстуры в P02]** → Механизм `assets/ASSET_MANIFEST.json` изначально поддерживает тип `synthetic-generated` с проверкой SHA-256 и лимитом `512` КиБ на файл, а синтетический мир большого размера в P02 генерируется процедурно в рантайме (`apps/asset-tool`), не хранясь бинарником в git.

---

## Migration Plan

Поскольку P00 — корневая фаза без существующего кода реализации, миграция данных не требуется; развёртывание происходит поэтапно в рамках реализации задач фазы:

1. **Инициализация рабочего пространства:** создание корневых манифестов (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.npmrc`), `packages/config` (TS/ESLint/Prettier/Vitest пресеты) и каркасов 6 приложений и 9 пакетов с фиксацией границ импорта.
2. **Подсистема конфигурации и БД-фундамент:** реализация типизированных загрузчиков конфигурации в `packages/config/env/*`, `.env.example` для корня и приложений, проверка `check:env`, а также подключение Drizzle и миграции `platform_env_metadata` + идемпотентный `seed` в `packages/db`.
3. **Локальное окружение и каркасы приложений:** развёртывание `docker-compose.yml` (`core` + `observability`), скриптов `bootstrap`, `doctor`, `env:reset`, и подключение `/healthz` + `/readyz` в `apps/api` и `apps/game-server`.
4. **Ворота качества и CI:** включение `husky`/`lint-staged`/`commitlint`, `.changeset`, `renovate.json`, скриптов `check:assets`, `check:secrets`, `check:licenses`, `check:audit`, `check:ci-integrity` и workflow `.github/workflows/ci.yml` + `.github/workflows/nightly.yml`.
5. **Активация защиты ветки `main`:** после первого зелёного прогона `ci-required` в PR на GitHub применяется `.github/rulesets/main.json` к ветке `main` (автоматически через GitHub API/Terraform либо администратором репозитория с верификацией).
6. **Стратегия отката:** изменения конфигурации инструментов, CI-воркфлоу и правил линтинга изолированы в декларативных файлах и откатываются стандартным `git revert` без влияния на данные; сброс локального стенда выполняется командой `pnpm env:reset --yes`.
7. **Прямая совместимость с P01–P36:** последующие фазы наполняют уже существующие каркасы `packages/*` и `apps/*` без перестройки рабочего пространства, просто добавляя новые схемы в `@uo3/config`, таблицы в `@uo3/db` и джобы в `ci.yml` (автоматически попадающие под `ci-required`).

---

## Open Questions

Блокирующих архитектурных вопросов для реализации P00 **нет** — все ключевые решения зафиксированы выше.

Отложимые детали, не влияющие на спецификации, архитектуру и задачи P00:
1. **Хостинг удалённого кэша Turborepo (после M1 / P12):** на старте достаточно бесплатного GitHub Actions cache (`actions/cache`); при росте кодовой базы и числа параллельных PR решение между Vercel Remote Cache и self-hosted S3-совместимым сервером кэша (например, `ducktors/turborepo-remote-cache`) подключается без изменений в коде через секреты `TURBO_API`/`TURBO_TEAM`/`TURBO_TOKEN`.
2. **Исключения покрытия для автогенерируемых OpenAPI-клиентов (P04):** при появлении генератора OpenAPI SDK в P04 соответствующие пути `**/generated/**` будут добавлены в стандартный список исключений пресетов `@uo3/config/vitest/*`.
