# Безопасность цепочки поставок (`config/security`)

## 1. Белый список лицензий SPDX (`licenses.policy.json`)

Проверка `pnpm check:licenses` анализирует полное дерево разрешённых зависимостей (`pnpm licenses list --json`) по белому списку пермиссивных лицензий (`MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `0BSD`, `CC0-1.0`, `Unlicense`, `MPL-2.0`, `Zlib`, `BlueOak-1.0.0`, `Python-2.0`) и блокирует `GPL`, `AGPL`, `LGPL`, `SSPL`, `UNLICENSED`, `UNKNOWN`.

Пример аудированного исключения:

```json
{
  "package": "example-pkg",
  "license": "LGPL-2.1-only",
  "reason": "Обоснование юридического ревью",
  "approvedBy": "security-owner"
}
```

## 2. Временные исключения уязвимостей (`audit-waivers.json`)

Проверка `pnpm check:audit` запускает `pnpm audit --prod --json` и блокирует любые `critical`/`high` уязвимости без активного waiver. Каждый waiver имеет максимальный срок действия **≤ 30 дней**:

```json
{
  "advisoryId": "GHSA-xxxx-xxxx-xxxx",
  "package": "affected-package",
  "reason": "Смягчено конфигурацией, ожидаем релиз патча",
  "owner": "platform-team",
  "createdAt": "2026-11-19T00:00:00.000Z",
  "expiresAt": "2026-12-10T00:00:00.000Z"
}
```

Просроченные waiver немедленно ломают CI.

## 3. Белый список lifecycle-скриптов (`pnpm.onlyBuiltDependencies`)

В корневом `package.json` задан явный белый список пакетов, которым разрешено запускать `postinstall` / native build scripts:

```json
"pnpm": {
  "onlyBuiltDependencies": ["esbuild"]
}
```

Добавление нового пакета (например, `argon2` в P04) требует явного PR-ревью и проверяется скриптом `pnpm check:workspace-manifests`.
