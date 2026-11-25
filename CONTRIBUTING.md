# Участие в разработке

## Коммиты

Conventional Commits: `<тип>(<область>): <описание>`, заголовок до 100 символов. Типы: `feat`, `fix`,
`docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Области — имена модулей,
`repo`, `ci`, `infra`, `deps`, `release` и фазы `p00`–`p36`.

## Хуки

`pnpm install` подключает husky. `pre-commit` проверяет только индексированные файлы: ESLint, Prettier,
ассеты и секреты. `commit-msg` проверяет формат. Нужен `gitleaks` 8. CI повторяет проверки.

## Changesets

Изменение `apps/*/src` или `packages/*/src` требует файла `.changeset/*.md` (`pnpm changeset`) либо
метки PR `no-changeset-needed`. Базовая ветка — `main`, доступ — `restricted`.

## Зависимости

Renovate ждёт 3 дня после релиза, кроме исправлений уязвимостей, и держит не больше 5 PR. Major-версии
идут отдельно с меткой `breaking-update`. Политика: [config/security](config/security/README.md).
