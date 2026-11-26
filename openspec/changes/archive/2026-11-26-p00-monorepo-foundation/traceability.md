# Трассируемость P00

Сверка сценариев `specs/platform/*/spec.md` с проверками (задача 15.7, 2026-11-26).
Статус: **авто** — автоматический тест или команда; **приёмка** — воспроизведено вручную в группе 15; **MVP** — проверка требует GitHub Actions и отложена до MVP решением владельца.

## monorepo-workspace

| Сценарий | Проверка | Статус |
| --- | --- | --- |
| Целостность реестра рабочего пространства | `scripts/check-workspace-manifests.test.ts` | авто |
| Несовместимая версия Node.js | `scripts/check-node-version.test.ts` | авто |
| Внутренние ссылки между пакетами | `check-workspace-manifests.test.ts` (`workspace:*`) | авто |
| Успешная проверка типов | `pnpm typecheck`, `packages/config/src/tsconfig/profiles.test.ts` | авто |
| Небезопасный индекс или неявный any | `profiles.test.ts` (TS7006, TS2322) | авто |
| Отклонение CommonJS | `packages/config/src/eslint/presets.test.ts`, `check-workspace-manifests.test.ts` | авто |
| Разрешённый импорт вниз по слоям | `scripts/check-boundaries.test.ts` | авто |
| Циклическая зависимость | `check-boundaries.test.ts` (цепочка цикла) | авто |
| Импорт из приложения | `check-boundaries.test.ts` (`no-import-from-app-api`) | авто |
| БД в браузерном клиенте | `check-boundaries.test.ts` (`browser-no-server`) | авто |
| UI в серверном приложении | `check-boundaries.test.ts`, `presets.test.ts` | авто |
| Бот без доступа к БД | `check-boundaries.test.ts` (`bot-and-asset-tool-no-db`) | авто |
| Сборка изоморфных пакетов | `pnpm build`, `profiles.test.ts` (isomorphic) | авто |
| Node-API или внешняя зависимость в domain | `check-boundaries.test.ts`, `check-workspace-manifests.test.ts` | авто |
| DOM в парсере форматов или правилах | `profiles.test.ts` (TS2584) | авто |
| test-kit в модульных тестах | `check-boundaries.test.ts`, `packages/test-kit/src/marker.test.ts` | авто |
| test-kit в производственном коде | `check-boundaries.test.ts` (`test-kit-only-in-tests`) | авто |
| test-kit в production dependencies | `check-workspace-manifests.test.ts` | авто |
| Форматирование и статический анализ | `pnpm lint`, `pnpm format:check` | авто |
| Неформатированный код или отключение правила | `presets.test.ts`, `lint-staged` в pre-commit | авто |
| Топологический порядок сборки | `turbo.json` (`^build`), `pnpm build` | авто |
| Попадание в кэш | `scripts/turbo-cache.test.ts` | авто |
| Инвалидация затронутого подграфа | `turbo-cache.test.ts` | авто |
| Установка frozen lockfile | `scripts/lockfile.test.ts` | авто |
| Расхождение манифеста с lockfile | `lockfile.test.ts` | авто |

## configuration-management

| Сценарий | Проверка | Статус |
| --- | --- | --- |
| Загрузка валидной конфигурации | `env/server/load.test.ts` | авто |
| Агрегация нескольких ошибок | `env/shared/errors.test.ts`, `schemas.test.ts` | авто |
| Переменная процесса важнее .env | `env/server/precedence.test.ts` | авто |
| .env игнорируется в production | `precedence.test.ts` | авто |
| Секрет из файла | `env/server/secret-files.test.ts` | авто |
| Конфликт переменной и файла | `secret-files.test.ts` | авто |
| Нечитаемый или пустой файл секрета | `secret-files.test.ts` | авто |
| Публичная клиентская конфигурация | `env/client/client-config.test.ts` | авто |
| Серверный секрет в клиентской схеме | `client-config.test.ts`, `vite/bundle-guard.test.ts` | авто |
| Заглушка секрета в production | `prod-guards.test.ts`, `apps/*/src/main.test.ts`; приёмка 15.5 (в) | авто |
| Заглушки в development и test | `prod-guards.test.ts` | авто |
| Логирование конфигурации при старте | `env/shared/redact.test.ts` | авто |
| Ошибка на секретном поле без значения | `load.test.ts` | авто |
| Мутация конфигурации | `env/shared/deep-freeze.test.ts` | авто |
| Консистентное чтение из модулей | `load.test.ts` (неизменяемый объект) | авто |
| Приведение типов | `primitives.test.ts`, `schemas.test.ts` | авто |
| Неоднозначный булев флаг или URL | `primitives.test.ts` | авто |
| Синхронность шаблонов | `scripts/check-env.test.ts` | авто |
| Незадокументированный или удалённый ключ | `check-env.test.ts` | авто |

## local-dev-environment

| Сценарий | Проверка | Статус |
| --- | --- | --- |
| Базовый стек | `infra/local/compose.integration.test.ts` | авто |
| Данные после перезапуска | `compose.integration.test.ts` | авто |
| Запрет плавающих тегов | `infra/local/compose.test.ts` | авто |
| Профиль наблюдаемости | приёмка 15.3: 8 контейнеров за 32 с, 3 datasource и дашборд — HTTP 200 | приёмка |
| Базовый профиль без наблюдаемости | `compose.test.ts` (профили разделены) | авто |
| Создание обеих баз | `compose.integration.test.ts` | авто |
| Тесты без повреждения dev | `packages/db/src/db.integration.test.ts` | авто |
| Смена портов | `compose.integration.test.ts` | авто |
| Занятый порт | `scripts/bootstrap.test.ts` | авто |
| Первичный bootstrap | `bootstrap.test.ts`; приёмка 15.1: 50 с | авто |
| Повторный bootstrap с настройками | `bootstrap.test.ts`; приёмка 15.1 | авто |
| Недоступный Docker | `bootstrap.test.ts` | авто |
| Миграции и seed на пустой БД | `db.integration.test.ts` | авто |
| Повторный db:seed | `db.integration.test.ts` | авто |
| Сброс стенда | `scripts/env-reset.test.ts` | авто |
| Защита удалённой БД | `env-reset.test.ts`; приёмка 15.5 (г) | авто |
| Здоровое окружение | `scripts/doctor.integration.test.ts` | авто |
| Остановленный Valkey | `doctor.test.ts`, `doctor.integration.test.ts` | авто |
| Готовность серверных каркасов | `apps/{api,game-server}/src/health.integration.test.ts`; приёмка 15.4 | авто |
| Потеря NATS или БД | `health.test.ts`, `health.integration.test.ts`; приёмка 15.4 | авто |

## code-quality-gates

| Сценарий | Проверка | Статус |
| --- | --- | --- |
| Пороги покрытия во всех слоях | `pnpm test:coverage` | авто |
| Падение ниже порога | `vitest/presets.test.ts` | авто |
| Исключение сгенерированных файлов | `presets.test.ts` | авто |
| Валидный коммит | `scripts/commitlint.test.ts` | авто |
| Неструктурированное или длинное сообщение | `commitlint.test.ts` | авто |
| Коммиты слияния и отката | `commitlint.test.ts` | авто |
| Проверка индексированных файлов | pre-commit; приёмка: 41 файл за 14 с | приёмка |
| Синтаксическая ошибка линтинга | приёмка 2026-11-26: pre-commit отклонил `export const a = ;` | приёмка |
| Проверка в CI при обходе хука | `quality-gates` в `ci.yml` | MVP |
| Производственное изменение с changeset | `scripts/check-changeset.test.ts` | авто |
| Изменение без changeset | `check-changeset.test.ts` | авто |
| Только документация | `check-changeset.test.ts` | авто |
| Схема Renovate | официальный валидатор не запускался (11.4) | MVP |
| Немедленные security-обновления | `scripts/renovate-policy.test.ts` | авто |
| Чистое дерево SPDX | `pnpm check:licenses` | авто |
| AGPL или неизвестная лицензия | `scripts/check-licenses.test.ts` | авто |
| Нет high/critical уязвимостей | `pnpm check:audit`, `check-audit.test.ts` | авто |
| Просроченное исключение | `check-audit.test.ts` | авто |
| Неавторизованный lifecycle-скрипт | `check-workspace-manifests.test.ts`, `onlyBuiltDependencies` | авто |
| Недопустимый бинарный формат | `scripts/check-assets.test.ts`; приёмка 15.5 (а) | авто |
| Исходник с именем игровых данных | `check-assets.test.ts` | авто |
| CC0-заглушка в реестре | `check-assets.test.ts` | авто |
| Крупный или незадекларированный файл | `check-assets.test.ts` | авто |
| Приватный ключ или токен | `scripts/check-secrets.test.ts`; приёмка 15.5 (б) | авто |
| Плейсхолдеры в .env.example | `check-secrets.test.ts` | авто |
| eval в клиентском коде | `eslint/security-rules.test.ts`, `presets.test.ts` | авто |

## ci-pipeline

Статические свойства workflow проверяют `scripts/check-ci-integrity.test.ts` и `scripts/ci-scope.test.ts`. Поведение на GitHub (параллельность, отмена, кэш, артефакты, время) подтверждается только запуском и отложено до MVP.

| Сценарий | Проверка | Статус |
| --- | --- | --- |
| Полный успешный прогон PR | — | MVP |
| Провал одной стадии блокирует слияние | `check-ci-integrity.test.ts` (матрица `ci-required`) | авто |
| Независимый сбор диагностики | стадии без взаимных `needs` (`check-ci-integrity`) | авто, запуск — MVP |
| Отмена устаревшего прогона PR | `concurrency` в `ci.yml` | MVP |
| Прогоны main не отменяются | `concurrency` в `ci.yml` | MVP |
| Кэш при неизменённом lockfile | `setup-workspace` | MVP |
| PR из форка без секретов | `setup-workspace` (пустой `TURBO_TOKEN`) | MVP |
| Листовое приложение | `ci-scope.test.ts` | авто |
| Полный прогон при корневом конфиге | `ci-scope.test.ts` | авто |
| Полный прогон на main | `ci-scope.test.ts` | авто |
| Интеграционные тесты на сервисах | — | MVP |
| Версии образов совпадают | `check-ci-integrity.test.ts` | авто |
| Артефакты после успеха | `check-ci-integrity.test.ts` (срок хранения) | авто, загрузка — MVP |
| Отчёты при провале | `check-ci-integrity.test.ts` (`if: always()`) | авто, загрузка — MVP |
| SHA и права токена | `check-ci-integrity.test.ts` | авто |
| Незафиксированный тег | `check-ci-integrity.test.ts` | авто |
| Валидность ruleset | `check-ci-integrity.test.ts` | авто, применение — MVP |
| Расхождение имени проверки | `check-ci-integrity.test.ts` | авто |
| Валидация OpenSpec в PR | шаг `OpenSpec` в `ci.yml` | MVP |
| Дрейф .env.example | `check-env.test.ts` | авто |

## Итог

110 сценариев сопоставлены с проверками: 94 авто, 3 приёмка, 13 требуют запуска GitHub Actions (4 из них статически проверены). `pnpm test:coverage` зелёный по всем модулям (2026-11-25).
