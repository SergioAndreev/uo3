# Безопасность зависимостей

- **Лицензии** — `licenses.policy.json`. Исключение указывает пакет, точную лицензию и причину:
  `{ "package": "x", "license": "CC-BY-4.0", "reason": "Нужен только при сборке" }`.
- **Уязвимости** — `audit-waivers.json`. Сначала обновите зависимость. Исключение действует до 30 дней:
  `{ "advisoryId": "GHSA-…", "package": "x", "reason": "Путь недостижим", "owner": "platform", "createdAt": "2026-01-01", "expiresAt": "2026-01-15" }`.
- **Lifecycle-скрипты** — `pnpm.onlyBuiltDependencies` в корневом `package.json`, например
  `["esbuild"]`. Новый пакет добавляется отдельным коммитом после чтения его скрипта.

`patches/@colyseus__core` и override `nanoid@3` закрывают уязвимости `nanoid@2`. При обновлении Colyseus
проверьте, нужен ли патч.
