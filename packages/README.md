# Слои и границы

Источник правил — `.dependency-cruiser.mjs`; та же матрица используется в
`packages/config/src/eslint/boundaries.ts`. Менять их нужно вместе с этой таблицей.

| Модуль                   | Разрешённые runtime-зависимости `@duskmarch/*`                                |
| ------------------------ | ----------------------------------------------------------------------------- |
| `packages/config`        | —                                                                             |
| `packages/domain`        | —                                                                             |
| `packages/rules`         | `domain`                                                                      |
| `packages/protocol`      | `domain`                                                                      |
| `packages/asset-formats` | `domain`                                                                      |
| `packages/content`       | `domain`, `rules`                                                             |
| `packages/db`            | `domain`, `config`                                                            |
| `packages/ui-kit`        | `domain`, `protocol`, `config`                                                |
| `packages/test-kit`      | `domain`, `rules`, `protocol`, `asset-formats`, `content`, `config`           |
| `apps/client`            | `domain`, `rules`, `protocol`, `asset-formats`, `content`, `ui-kit`, `config` |
| `apps/admin`             | `domain`, `protocol`, `content`, `ui-kit`, `config`                           |
| `apps/api`               | `domain`, `rules`, `protocol`, `content`, `db`, `config`                      |
| `apps/game-server`       | `domain`, `rules`, `protocol`, `asset-formats`, `content`, `db`, `config`     |
| `apps/asset-tool`        | `domain`, `asset-formats`, `content`, `config`                                |
| `apps/bot-client`        | `domain`, `rules`, `protocol`, `config`                                       |

## Добавление зависимости

1. Убедитесь, что ребро есть в матрице и не создаёт цикла.
2. Добавьте `"@duskmarch/<имя>": "workspace:*"` в `dependencies`.
3. `@duskmarch/test-kit` допустим только в `devDependencies` и тестах.
4. `domain` может иметь единственную внешнюю runtime-зависимость: `@sinclair/typebox`.
5. Запустите `pnpm check:boundaries` и `pnpm check:workspace-manifests`.
