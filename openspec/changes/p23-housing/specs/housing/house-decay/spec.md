# Спецификация: housing/house-decay

## Purpose

Определяет шестистадийный жизненный цикл износа и распада дома, механику автоматического обновления состояния при взаимодействии с дверьми и вывеской, процедуру обрушения дома на стадии IDOC (In Danger of Collapsing) с выпадением имущества на землю, работу гампа вывески дома, интерактивную передачу прав владения и добровольный снос дома в дид.

## ADDED Requirements

### Requirement: Six-Stage House Condition and Decay Timeline
Каждый дом без флага `Grandfathered` SHALL проходить 6 стадий износа за `216` реальных часов (9 суток) без обновления: `LIKE_NEW` (`0..1` ч), `SLIGHTLY_WORN` (`1..48` ч), `SOMEWHAT_WORN` (`48..96` ч), `FAIRLY_WORN` (`96..144` ч), `GREATLY_WORN` (`144..198` ч) и `IDOC` (`198..216` ч). На 198-м часу сервер MUST назначать случайный момент обрушения в окне `203..216` часов.

#### Scenario: House transitions to Greatly Worn after six days of inactivity
- **WHEN** с момента последнего `lastRefreshedAt` дома прошло 150 реальных часов
- **AND** игрок кликает по вывеске дома
- **THEN** сервер возвращает стадию `GREATLY_WORN` с текстом «This house is greatly worn.»

#### Scenario: House enters IDOC stage after 198 hours
- **WHEN** с момента последнего `lastRefreshedAt` дома проходит 198 реальных часов
- **THEN** дом переходит в стадию `IDOC`, и сервер назначает скрытый момент окончательного обрушения со случайным смещением внутри окна `198..216` часов

### Requirement: Automatic Decay Refresh via Door or Sign Interaction
Когда персонаж с ролью `Owner`, `Co-Owner` или `Friend` данного дома открывает или закрывает любую дверь дома, либо открывает гамп вывески дома (`House Sign Gump`), сервер SHALL мгновенно сбрасывать таймер износа дома (`lastRefreshedAt = now`) и переводить состояние дома обратно в стадию `LIKE_NEW`. Действия посторонних посетителей или персонажей из `Access List` MUST NOT обновлять таймер распада.

#### Scenario: Friend opening front door refreshes house condition
- **WHEN** дом находится на стадии `FAIRLY_WORN`
- **AND** персонаж из списка `Friends` открывает входную дверь дома
- **THEN** сервер обновляет `lastRefreshedAt` до текущего времени и возвращает стадию дома в `LIKE_NEW`

#### Scenario: Stranger opening public house door does not refresh decay
- **WHEN** посторонний покупатель открывает дверь публичного дома, находящегося на стадии `GREATLY_WORN`
- **THEN** дверь открывается, но `lastRefreshedAt` и стадия износа дома остаются без изменений

### Requirement: IDOC Collapse and Ground Loot Explosion
При наступлении времени обрушения в стадии `IDOC` сервер SHALL атомарно удалить мульти дома, уничтожить аддоны и мусорную бочку, ликвидировать вендоров (переведя их золото в банк владельцев), снять флаги `isLockedDown` и `isSecure` со всех предметов и сундуков и уронить их на землю на высоте рельефа с 60-минутным таймером распада.

#### Scenario: House collapses at IDOC expiration and drops all contents to ground
- **WHEN** таймер дома в стадии `IDOC` достигает точки обрушения
- **THEN** стены, двери и вывеска дома исчезают, все бывшие зафиксированные предметы и сундуки оказываются на земле в открытом доступе для любого игрока, а в `item_ledger` фиксируется событие `HOUSE_COLLAPSE_IDOC`

#### Scenario: Characters standing on upper floors fall to ground level on collapse
- **WHEN** в момент обрушения `IDOC` на втором этаже или крыше дома (`Z > groundZ`) находятся игроки или NPC
- **THEN** сервер мгновенно пересчитывает их координату `Z` на уровень рельефа земли и отправляет `TeleportSync` без нанесения урона

### Requirement: House Sign Gump and Condition Inspection
При двойном клике по вывеске дома в пределах 18 тайлов сервер SHALL открывать гамп дома. Первая вкладка MUST показывать любому игроку название дома, имя владельца, режим публичности и стадию износа; вкладки списков, переименования (до 60 символов), смены знака вывески (54 варианта UO:R), передачи и сноса MUST проверяться по роли (`Owner` / `Co-Owner` / `Friend`).

#### Scenario: Stranger inspects house sign condition
- **WHEN** посторонний игрок дважды кликает по вывеске чужого дома
- **THEN** сервер отправляет дескриптор `House Sign Gump` только с информационной вкладкой (название, владелец, стадия распада) и блокирует любые управляющие действия с кодом `ERR_HOUSE_INSUFFICIENT_PERMISSION`

#### Scenario: Owner renames house and changes sign graphic
- **WHEN** владелец дома отправляет через гамп вывески новое название «Villa of Trammel» и валидный `signGraphicId` из каталога
- **THEN** сервер обновляет название и иконку вывески в мире для всех игроков в AOI

### Requirement: Interactive House Ownership Transfer
Владелец дома (`Owner`) SHALL иметь возможность передать дом другому персонажу через кнопку «Transfer Ownership» в гампе вывески с выбором цели в пределах 12 тайлов и LOS. Передача MUST требовать отсутствия активных вендоров игроков в доме, отсутствия у аккаунта получателя другого дома и двухстороннего подтверждения через модальное окно `Trade/Transfer Confirmation`; фиксации, сундуки и списки доступа при передаче сохраняются.

#### Scenario: Successful house ownership transfer between two players
- **WHEN** владелец выбирает целью передачи персонажа, чей аккаунт не владеет домом и не имеет кулдауна постройки
- **AND** получатель подтверждает приём дома в диалоговом гампе в течение 30 секунд
- **THEN** сервер атомарно (`RPO = 0`) меняет `ownerCharacterId` и `ownerAccountId` дома, очищает роль старого владельца, меняет замки с выдачей новых ключей новому владельцу и пишет `HOUSE_TRANSFER` в `item_ledger`

#### Scenario: Rejecting transfer to an account that already owns a house
- **WHEN** владелец пытается передать дом персонажу, на аккаунте которого уже числится другой дом
- **THEN** сервер отклоняет передачу с кодом `ERR_HOUSE_RECIPIENT_ACCOUNT_LIMIT`

### Requirement: House Demolition and Deed Refund
Владелец дома (`Owner`) SHALL иметь возможность снести дом через гамп вывески при отсутствии внутри активных вендоров (`ERR_HOUSE_HAS_ACTIVE_VENDORS`). При сносе сервер MUST снять фиксацию со всех предметов и сундуков (оставив их на земле), удалить мульти дома и выдать владельцу дид дома (или чек на 80% цены при сносе в первые 168 часов).

#### Scenario: Owner demolishes house older than seven days and receives deed
- **WHEN** владелец подтверждает снос дома, построенного более 168 часов назад, в котором нет вендоров игроков
- **THEN** мульти дома удаляется, все предметы из интерьера падают на землю без флага фиксации, а оригинальный `House Deed` помещается в рюкзак владельца с записью `HOUSE_REDEED` в `item_ledger`

#### Scenario: Demolition blocked while player vendors are inside
- **WHEN** владелец пытается снести дом, в котором стоит хотя бы один активный Player Vendor
- **THEN** сервер отклоняет снос с кодом `ERR_HOUSE_HAS_ACTIVE_VENDORS`

### Requirement: Grandfathered and Condemned House State
Администратор с уровнем доступа `AccessLevel >= GameMaster` SHALL иметь возможность переключать на доме флаги `isGrandfathered = true` (заморозка распада — вывеска отображает «This house is ageless.») или `isCondemned = true` (принудительная блокировка передачи и перевода в публичный режим для домов, оказавшихся в запретной зоне после патча карты).

#### Scenario: Grandfathered house does not advance decay timer
- **WHEN** на доме установлен административный флаг `isGrandfathered = true`
- **AND** владелец не заходит в игру более 30 суток
- **THEN** планировщик распада пропускает этот дом, а вывеска неизменно показывает «This house is ageless.»

#### Scenario: Condemned house blocks ownership transfer
- **WHEN** владелец дома со статусом `isCondemned = true` пытается передать дом другому игроку
- **THEN** сервер отклоняет передачу с кодом `ERR_HOUSE_CONDEMNED`

### Requirement: House Ledger Audit and Telemetry Events
Каждая критическая операция жизненного цикла дома (`HOUSE_PLACE`, `HOUSE_TRANSFER`, `HOUSE_REDEED`, `HOUSE_COLLAPSE_IDOC`, `HOUSE_LOCKS_CHANGED`) SHALL синхронно фиксироваться через `CriticalTxCoordinator` в таблице `item_ledger` с указанием `houseId`, серийного номера дида/чека, `accountId` участников и координат `(facetId, x, y, z)`, а также публиковать метрики количества активных домов и стадий IDOC в Prometheus.

#### Scenario: Auditing IDOC collapse in item ledger
- **WHEN** дом обрушивается по таймеру `IDOC`
- **THEN** в таблице `item_ledger` создаётся неизменяемая запись `HOUSE_COLLAPSE_IDOC` с метаданными бывшего владельца, списком освобождённых сундуков и временем обрушения
