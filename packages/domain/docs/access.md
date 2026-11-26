# Уровни доступа и разрешения

Модуль `@duskmarch/domain` → `access`. Уровни определены в `catalog/social.ts` (`ACCESS_LEVELS`), порядок старшинства:

`player < helper < moderator < game-master < administrator < owner`

Персонал — любой уровень от `helper`. Персоналу для своих прав нужен второй фактор (`mfa`).

## Разрешения

Таблица `PERMISSIONS`: разрешение → минимальный уровень. Старший уровень наследует права младших. Разрешение вне таблицы запрещено всем.

| Разрешение | Минимальный уровень | Назначение |
|---|---|---|
| `player.assist` | `helper` | Ответы на обращения игроков |
| `chat.warn` | `helper` | Предупреждения в чате |
| `account.inspect` | `moderator` | Карточка аккаунта без секретов |
| `account.sessions.revoke` | `moderator` | Завершение сессий младших аккаунтов |
| `account.ban.temp` | `moderator` | Временный бан до 30 суток |
| `world.observe` | `moderator` | Невидимое наблюдение в мире |
| `character.manage` | `moderator` | Блокировка и принудительное переименование героев |
| `world.events.manage` | `game-master` | Мировые события |
| `world.edit` | `game-master` | Патчи мира (P03) |
| `beacon.manage` | `game-master` | Маяки между планами |
| `character.restore` | `game-master` | Восстановление удалённых героев |
| `account.ban.permanent` | `administrator` | Бан без срока или длиннее 30 суток |
| `account.unban` | `administrator` | Досрочное снятие бана |
| `account.tfa.reset` | `administrator` | Сброс утерянной 2FA |
| `account.access.assign` | `administrator` | Назначение уровней |
| `audit.read` | `administrator` | Журнал аудита |
| `shard.manage` | `administrator` | Управление шардами |
| `ruleset.manage` | `owner` | Профиль правил |

## Функции

- `evaluateAccess(ctx, permission)` — единая проверка для API и игрового сервера. Контекст: `maxLevel` (назначенный), `effectiveLevel` (с которым сотрудник играет), `mfa`, `banned`. Проверяется эффективный уровень, обрезанный назначенным. Причины отказа: `unknown_permission`, `banned`, `insufficient`, `mfa_required`.
- `canActOn(actor, target)` — бан, отзыв сессий, сброс 2FA допустимы только над строго младшим уровнем.
- `canAssign(actor, current, next)` — `administrator` назначает до `game-master` включительно, `owner` — любые уровни, в том числе другому `owner`. Защиту последнего владельца проверяет хранилище.
- `canSetEffective(max, next)` — игра с пониженным уровнем: от `player` до назначенного.
