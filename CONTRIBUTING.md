# Руководство по участию в разработке UO3 (`CONTRIBUTING.md`)

## Conventional Commits 1.0

Все сообщения коммитов и заголовки squash-PR проверяются через `commitlint.config.mjs`:

- **Формат:** `<type>(<scope>): <subject>` (длина заголовка ≤ `100` символов, непустой `subject`)
- **Разрешённые типы:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- **Разрешённые области (`scope`):** имена всех 15 модулей (`client`, `api`, `game-server`, `admin`, `asset-tool`, `bot-client`, `domain`, `rules`, `protocol`, `uo-formats`, `content`, `db`, `ui-kit`, `config`, `test-kit`), служебные (`repo`, `ci`, `infra`, `deps`, `release`, `spec`) и номера фаз (`p00`..`p36`)
- **Примеры:**
  - `feat(config): add typed server env validation`
  - `docs(p00): update bootstrap instructions`
  - Автоматические коммиты `Revert "..."` и `chore(release): version packages` пропускаются автоматически.

## Локальные git-хуки (`husky` + `lint-staged`)

Хуки устанавливаются автоматически при `pnpm install` (`prepare: "husky"`):

- **`.husky/pre-commit`**: Prettier + ESLint только по staged-файлам, `check:assets --staged` (ADR-002), `check:secrets --staged` (≤ `15` с).
- **`.husky/commit-msg`**: проверка формата Conventional Commits через `commitlint`.

Обход хуков флагом `--no-verify` не позволяет обойти контроль: те же проверки дублируются в CI `quality-gates`.

## Версионирование через Changesets

Конфигурация находится в `.changeset/config.json` (`baseBranch: "main"`, `access: "restricted"`).

- При изменении производственного кода в `apps/*/src/**` или `packages/*/src/**` добавьте changeset командой `pnpm exec changeset` (либо укажите метку PR `no-changeset-needed` для внутренних рефакторингов без релизного эффекта).
- Изменения исключительно в `docs/**`, `openspec/**`, тестах и `.github/**` не требуют файла changeset.

## Политика обновлений зависимостей (Renovate)

Конфигурация `renovate.json`:

- Группировка minor/patch-обновлений по экосистемам (`tooling-typescript`, `server-stack`, `client-stack`, `docker-images`, `github-actions`).
- Период стабилизации `minimumReleaseAge: "3 days"` для защиты от скомпрометированных свежих релизов.
- Исключение для уязвимостей безопасности (`vulnerabilityAlerts`: немедленный выпуск без задержки).
- Пиннинг дайджестов Docker и полных 40-символьных SHA для GitHub Actions.
- Ограничение `prConcurrentLimit: 5` и выделение `major`-обновлений с меткой `breaking-update`.
