# Общие пакеты монорепозитория UO3 (`packages/*`)

Граф зависимостей пакетов образует строгий направленный ациклический граф (DAG), контролируемый автоматически через `pnpm check:boundaries` (`.dependency-cruiser.mjs`), `pnpm lint` (`eslint-plugin-boundaries`) и `pnpm check:workspace-manifests`.

## Матрица архитектурных слоёв

| Слой | Пакет             | Платформа                            | Разрешённые runtime `@uo3/*`                                                                   | Запрещено                                                                           |
| ---- | ----------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 0    | `@uo3/config`     | Split (`shared`, `server`, `client`) | —                                                                                              | Любые `@uo3/*`; `node:*` в `/env/client` и `/env/shared`                            |
| 1    | `@uo3/domain`     | Isomorphic (Pure)                    | — (из внешних только `@sinclair/typebox`)                                                      | Любые `@uo3/*`, `node:*`, DOM (`window`, `document`), прочие внешние `dependencies` |
| 2    | `@uo3/rules`      | Isomorphic                           | `@uo3/domain`                                                                                  | `@uo3/db`, `@uo3/ui-kit`, `node:*`, DOM                                             |
| 2    | `@uo3/protocol`   | Isomorphic                           | `@uo3/domain`                                                                                  | `@uo3/db`, `@uo3/ui-kit`, `node:*`, DOM                                             |
| 2    | `@uo3/uo-formats` | Isomorphic                           | `@uo3/domain`                                                                                  | `@uo3/db`, `@uo3/ui-kit`, `node:*`, DOM                                             |
| 2    | `@uo3/content`    | Isomorphic                           | `@uo3/domain`, `@uo3/rules`                                                                    | `@uo3/db`, `@uo3/ui-kit`                                                            |
| 3    | `@uo3/db`         | Server (Node 22)                     | `@uo3/domain`, `@uo3/config`                                                                   | `@uo3/ui-kit`, `react`, `three`                                                     |
| 3    | `@uo3/ui-kit`     | Browser (React 19)                   | `@uo3/domain`, `@uo3/protocol`, `@uo3/config` (client/shared)                                  | `@uo3/db`, `@uo3/config/env/server`, `node:*`, `@nestjs/*`, `colyseus`              |
| 4    | `@uo3/test-kit`   | Dev/Test-only                        | `@uo3/domain`, `@uo3/rules`, `@uo3/protocol`, `@uo3/uo-formats`, `@uo3/content`, `@uo3/config` | Использование в production `src/` и в `dependencies` любых модулей                  |

## Правила добавления зависимостей

1. Внутренние ссылки между пакетами области `@uo3/*` указываются исключительно через протокол `"workspace:*"`.
2. Пакеты нижних слоёв не могут зависеть от верхних; циклы любой длины запрещены.
3. Пакеты никогда не импортируют код из `apps/*`.
4. `@uo3/test-kit` добавляется строго в `devDependencies` и импортируется только в `*.test.ts`, `*.test.tsx`, `*.integration.test.ts`.
5. Перед коммитом обязательно проверьте границы: `pnpm check:boundaries && pnpm check:workspace-manifests`.
