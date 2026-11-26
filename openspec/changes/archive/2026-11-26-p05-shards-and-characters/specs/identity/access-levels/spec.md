# Дельта: identity/access-levels

## MODIFIED Requirements

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
