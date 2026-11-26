# identity/access-levels Specification

## Purpose
Спецификация определяет шесть уровней доступа Duskmarch (`player`, `helper`, `moderator`, `game-master`, `administrator`, `owner`), матрицу разрешений с запретом по умолчанию, единую чистую функцию проверки прав для HTTP API и игрового сервера, иерархические ограничения действий над чужими аккаунтами, назначение уровней, режим игры с пониженным уровнем и неизменяемый аудит изменений доступа.

## Requirements

### Requirement: Иерархия уровней доступа Duskmarch
Система MUST поддерживать ровно шесть уровней доступа в строгом порядке старшинства `player < helper < moderator < game-master < administrator < owner`, взятых из перечисления `ACCESS_LEVELS` пакета `@duskmarch/domain`. Персоналом SHALL считаться любой уровень от `helper` и выше. Значение вне перечисления MUST отклоняться при разборе запроса, токена или записи БД.

#### Scenario: Линейный порядок старшинства
- **WHEN** система сравнивает два уровня из набора
- **THEN** результат сравнения совпадает с порядком индексов в `ACCESS_LEVELS`
- **AND** `isStaff('player')` ложно, а `isStaff('helper')` истинно

#### Scenario: Отклонение неизвестного уровня
- **WHEN** запрос назначения передаёт уровень `superuser`
- **THEN** система отклоняет запрос с HTTP `400 Bad Request` и кодом `RBAC_UNKNOWN_ACCESS_LEVEL`

### Requirement: Матрица разрешений с запретом по умолчанию
Система SHALL вычислять разрешения уровня по неизменяемой таблице `PERMISSIONS` «разрешение → минимальный уровень»; старший уровень наследует все разрешения младших. Разрешение вне таблицы MUST считаться запрещённым для всех уровней.

#### Scenario: Права помощника
- **WHEN** вычисляются разрешения уровня `helper`
- **THEN** набор равен `player.assist` (ответы на обращения) и `chat.warn` (предупреждения в чате), а у `player` разрешений нет

#### Scenario: Права модератора
- **WHEN** вычисляются разрешения уровня `moderator`
- **THEN** сверх прав `helper` набор содержит `account.inspect`, `account.sessions.revoke`, `account.ban.temp` (до 30 суток), `world.observe` и `character.manage` (блокировка и принудительное переименование героев)

#### Scenario: Права ведущего
- **WHEN** вычисляются разрешения уровня `game-master`
- **THEN** сверх прав `moderator` набор содержит `world.events.manage`, `world.edit` (патчи мира), `beacon.manage` (маяки) и `character.restore` (восстановление удалённых героев), но не `account.ban.permanent`

#### Scenario: Права администратора и владельца
- **WHEN** вычисляются разрешения уровней `administrator` и `owner`
- **THEN** `administrator` сверх прав `game-master` получает `account.ban.permanent`, `account.unban`, `account.tfa.reset`, `account.access.assign`, `audit.read` и `shard.manage`
- **AND** только `owner` получает `ruleset.manage`

#### Scenario: Отказ по неизвестному разрешению
- **WHEN** код проверяет строку `world.destroy`, которой нет в таблице
- **THEN** проверка возвращает отказ для любого уровня, включая `owner`

### Requirement: Авторизация запросов HTTP API
Защищённый эндпоинт HTTP API MUST проверять подлинность Access JWT, отсутствие сессии в списке отзыва, отсутствие активного бана и наличие требуемого разрешения у уровня `acl`. Для разрешений персонала токен SHALL содержать `mfa: true`. Отказ по правам MUST возвращать HTTP `403 Forbidden` с кодом `RBAC_INSUFFICIENT_PERMISSION` или `TFA_SETUP_REQUIRED`.

#### Scenario: Доступ модератора к инспекции аккаунта
- **WHEN** `moderator` с токеном `mfa: true` запрашивает карточку аккаунта игрока
- **THEN** система возвращает HTTP `200 OK` без хэшей пароля, секретов TOTP и значений токенов

#### Scenario: Отказ игроку на эндпоинте персонала
- **WHEN** `player` обращается к эндпоинту, требующему `account.inspect`
- **THEN** система возвращает HTTP `403 Forbidden` с кодом `RBAC_INSUFFICIENT_PERMISSION`

#### Scenario: Отказ сотруднику без второго фактора
- **WHEN** `moderator` с токеном `mfa: false` обращается к эндпоинту, требующему `account.inspect`
- **THEN** система возвращает HTTP `403 Forbidden` с кодом `TFA_SETUP_REQUIRED`

### Requirement: Единый контракт проверки прав для игрового сервера
Пакет `@duskmarch/domain` SHALL экспортировать чистую функцию `evaluateAccess(context, permission)`, где контекст содержит `maxLevel`, `effectiveLevel`, `mfa` и `banned`. Функция MUST использовать `effectiveLevel` для проверки, отказывать при `banned = true` и отказывать в разрешениях персонала при `mfa = false`, возвращая причину отказа.

#### Scenario: Игровая команда по эффективному уровню
- **WHEN** контекст `{ maxLevel: 'game-master', effectiveLevel: 'game-master', mfa: true, banned: false }` проверяет `world.events.manage`
- **THEN** функция возвращает `{ allowed: true }`

#### Scenario: Отказ при игре с пониженным уровнем
- **WHEN** сотрудник с `maxLevel = 'game-master'` переключился на `effectiveLevel = 'player'` и проверяет `world.edit`
- **THEN** функция возвращает `{ allowed: false, reason: 'insufficient' }`

#### Scenario: Отказ при бане или без второго фактора
- **WHEN** контекст содержит `banned: true` или `mfa: false` для разрешения персонала
- **THEN** функция возвращает отказ с причиной `banned` или `mfa_required`

### Requirement: Иерархические ограничения действий над аккаунтами
Действия над чужим аккаунтом (бан, снятие бана, отзыв сессий, сброс 2FA, смена уровня) MUST разрешаться только если уровень исполнителя строго выше уровня цели; исключение — `owner` действует на другого `owner` только при смене уровня с защитой последнего `owner`. Нарушение SHALL отклоняться с HTTP `403 Forbidden` и кодом `RBAC_HIERARCHY_VIOLATION`.

#### Scenario: Запрет действия над равным уровнем
- **WHEN** `moderator` пытается забанить другого `moderator`
- **THEN** система отклоняет запрос с кодом `RBAC_HIERARCHY_VIOLATION`

#### Scenario: Запрет действия над старшим уровнем
- **WHEN** `administrator` пытается отозвать сессии `owner`
- **THEN** система отклоняет запрос с кодом `RBAC_HIERARCHY_VIOLATION`

#### Scenario: Действие над младшим уровнем
- **WHEN** `administrator` отзывает сессии `game-master`
- **THEN** система отзывает все сессии цели и возвращает число завершённых сессий

### Requirement: Назначение уровней и защита последнего владельца
Назначение уровня SHALL требовать разрешения `account.access.assign`, свежего подтверждения TOTP-кодом и причины длиной 10–1000 символов. `administrator` MUST назначать уровни не выше `game-master`; `owner` — любые уровни. Понижение или бан единственного активного `owner` MUST отклоняться с HTTP `409 Conflict` и кодом `RBAC_LAST_OWNER`.

#### Scenario: Повышение игрока до модератора
- **WHEN** `administrator` с подтверждённым TOTP назначает аккаунту `player` уровень `moderator` с причиной
- **THEN** система обновляет уровень, отзывает сессии цели, пишет запись аудита и публикует событие `identity.account.access_level_changed`

#### Scenario: Запрет назначения уровня не ниже собственного
- **WHEN** `administrator` назначает аккаунту уровень `administrator`
- **THEN** система отклоняет запрос с кодом `RBAC_HIERARCHY_VIOLATION`

#### Scenario: Защита единственного владельца
- **WHEN** единственный активный `owner` понижает себя до `administrator`
- **THEN** система отклоняет запрос с HTTP `409 Conflict` и кодом `RBAC_LAST_OWNER`

### Requirement: Немедленное вступление изменений уровня в силу
После изменения уровня система MUST отозвать все сессии цели, внести их `sid` в список отзыва на оставшийся срок Access JWT и опубликовать событие `identity.account.access_level_changed` с `accountId`, `previousLevel`, `newLevel`, `changedBy` и `occurredAt`.

#### Scenario: Отзыв сессий при понижении
- **WHEN** `administrator` понижает `game-master` до `player`
- **THEN** следующий запрос с прежним Access JWT цели отклоняется с HTTP `401 Unauthorized` и кодом `AUTH_SESSION_REVOKED`

#### Scenario: Событие при повышении
- **WHEN** `owner` повышает `helper` до `moderator`
- **THEN** публикуется событие с `previousLevel: 'helper'` и `newLevel: 'moderator'`

### Requirement: Игра с пониженным уровнем
Сотрудник SHALL иметь возможность установить эффективный игровой уровень в диапазоне от `player` до своего назначенного уровня. Значение хранится в аккаунте, попадает в новые Access JWT как `eacl` и не может превышать назначенный уровень.

#### Scenario: Переключение ведущего в режим игрока и обратно
- **WHEN** `game-master` устанавливает эффективный уровень `player`, а затем `game-master`
- **THEN** система сохраняет каждое значение, отвечает HTTP `200 OK` и публикует `identity.account.effective_level_changed`

#### Scenario: Запрет повышения сверх назначенного
- **WHEN** `helper` устанавливает эффективный уровень `moderator`
- **THEN** система отклоняет запрос с кодом `RBAC_HIERARCHY_VIOLATION`

### Requirement: Неизменяемый аудит доступа
Каждое изменение уровня, бан, снятие бана, сброс 2FA, отзыв чужих сессий и каждый отказ по правам на эндпоинтах персонала MUST записываться в таблицу `access_audit_log`, которую код только дополняет. Чтение журнала SHALL требовать разрешения `audit.read`.

#### Scenario: Полный контекст изменения уровня
- **WHEN** `administrator` меняет уровень цели с `player` на `helper`
- **THEN** запись аудита содержит исполнителя, цель, действие, прежнее и новое значение, причину, IP, User-Agent и время UTC

#### Scenario: Запись отказа
- **WHEN** `helper` вызывает эндпоинт назначения уровней
- **THEN** система отвечает `403` и пишет запись аудита с исходом `denied`

#### Scenario: Чтение журнала ограничено
- **WHEN** `game-master` запрашивает журнал аудита
- **THEN** система отклоняет запрос с кодом `RBAC_INSUFFICIENT_PERMISSION`
