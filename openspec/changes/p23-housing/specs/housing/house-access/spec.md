# Спецификация: housing/house-access

## Purpose

Определяет ролевую модель управления доступом к дому (Owner, Co-Owners, Friends, Access List, Ban List), режимы публичности (Public / Private), механику физических ключей и смены замков, принудительное выдворение нежелательных посетителей, блокировку магической телепортации и правила мгновенного безопасного выхода из игры внутри дома.

## ADDED Requirements

### Requirement: Public and Private House Access Modes
Каждый дом SHALL находиться в одном из двух режимов: `PRIVATE` (по умолчанию при постройке) или `PUBLIC`. В режиме `PRIVATE` открывать входную дверь и входить внутрь без ключа могут только `Owner`, `Co-Owners`, `Friends` и персонажи из `Access List`. В режиме `PUBLIC` входная дверь открыта для всех, кроме персонажей из `Ban List`, и разрешена установка вендоров игроков.

#### Scenario: Switching house from private to public mode
- **WHEN** владелец переключает режим дома в `PUBLIC` через гамп вывески
- **AND** внутри дома нет агрессивных NPC или монстров
- **THEN** дом становится публичным, замки с внешних дверей снимаются, а любой незабаненный игрок может войти внутрь

#### Scenario: Blocking switch to private when player vendors exist
- **WHEN** владелец пытается переключить публичный дом обратно в режим `PRIVATE`
- **AND** внутри дома размещён хотя бы один активный Player Vendor
- **THEN** сервер отклоняет переключение с кодом `ERR_HOUSE_HAS_ACTIVE_VENDORS`

### Requirement: Owner Co-Owner and Friend Role Hierarchy
Сервер SHALL поддерживать списки ролей на каждый дом: 1 `Owner`, до 8 `Co-Owners`, до 50 `Friends`, до 50 записей в `Access List` и до 50 записей в `Ban List`. `Owner` управляет всеми списками; `Co-Owners` управляют списками `Friends`, `Access List` и `Ban List`; `Friends` могут добавлять игроков в `Ban List` и изгонять нарушителей.

#### Scenario: Owner adds a co-owner via target cursor
- **WHEN** владелец нажимает «Add Co-Owner» в гампе вывески и указывает курсором на другого персонажа в пределах 12 тайлов и LOS
- **AND** в списке `Co-Owners` менее 8 записей
- **THEN** выбранный персонаж добавляется в `Co-Owners` и получает доступ к управлению фиксацией и друзьями

#### Scenario: Rejecting list addition when capacity limit is reached
- **WHEN** совладелец пытается добавить 51-го персонажа в список `Friends`
- **THEN** сервер отклоняет операцию с кодом `ERR_HOUSE_LIST_FULL`

### Requirement: Door Keys Keyrings and Lock Changes
При постройке частного дома все его двери SHALL иметь единый `lockId`, открываемый соответствующим медным ключом (`0x100E`) или связкой ключей (`0x1011`). При выборе владельцем опции «Change House Locks» в гампе дома сервер MUST генерировать новый `lockId`, делать все старые ключи недействительными и создавать пару новых мастер-ключей в рюкзаке и банке владельца.

#### Scenario: Unlocking and locking front door with matching key
- **WHEN** игрок использует ключ или связку ключей с совпадающим `lockId` на дверь дома в пределах 2 тайлов
- **THEN** сервер переключает состояние замка двери (`isLocked = !isLocked`) и отправляет клиенту звуковой эффект замка

#### Scenario: Old keys invalidated after changing house locks
- **WHEN** владелец выполняет «Change House Locks»
- **AND** бывший друг пытается отпереть дверь старым физическим ключом
- **THEN** сервер отклоняет действие с кодом `ERR_HOUSE_KEY_MISMATCH`

### Requirement: Ban List Management and Ejection
Владелец, совладелец или друг, находящийся внутри периметра дома, SHALL иметь возможность произнести фразу `I ban thee` (или выбрать кнопку в гампе) для открытия курсора бана на 30 секунд. При выборе цели внутри дома, не являющейся `Owner`, `Co-Owner`, `Friend` или персонажем с `AccessLevel >= Counselor`, цель MUST быть добавлена в `Ban List` и мгновенно телепортирована на точку перед южным крыльцом `(signX, signY + 1, signZ)`.

#### Scenario: Banning an intruder via verbal command
- **WHEN** друг дома произносит `I ban thee` внутри дома и указывает на постороннего игрока в комнате
- **THEN** нарушитель добавляется в `Ban List` дома и мгновенно переносится на тайл перед вывеской дома с пакетом `TeleportSync`

#### Scenario: Banned player blocked from stepping onto house steps
- **WHEN** персонаж, находящийся в `Ban List` дома, пытается сделать шаг на любой тайл футпринта дома (включая крыльцо)
- **THEN** сервер отклоняет шаг пакетом `WalkDeny` с кодом `ERR_HOUSE_BANNED`

### Requirement: Ejection of Non-Permitted Visitors
Команда `Remove thyself` (или кнопка «Eject» в гампе вывески), вызванная владельцем, совладельцем или другом внутри дома, SHALL телепортировать выбранного постороннего игрока или NPC из периметра дома на точку перед вывеской `(signX, signY + 1, signZ)` без добавления в постоянный `Ban List`.

#### Scenario: Ejecting a visitor without banning
- **WHEN** совладелец произносит `Remove thyself` и указывает на посетителя в публичном доме
- **THEN** посетитель мгновенно телепортируется за пределы дома к вывеске, но сохраняет возможность войти снова, если дом публичный

#### Scenario: Rejecting ejection of a co-owner or friend
- **WHEN** друг дома пытается применить `Remove thyself` или `I ban thee` против другого друга или совладельца этого же дома
- **THEN** сервер отклоняет действие с кодом `ERR_HOUSE_TARGET_PROTECTED`

### Requirement: Magic Teleportation Recall and Gate Restrictions
Реализация региональной политики заклинаний (`IRegionSpellPolicy`) SHALL запрещать сотворение заклинания `Mark` на любом тайле внутри футпринта дома, а также блокировать прибытие через `Recall`, `Gate Travel` и прямое применение `Teleport` на любой тайл внутри футпринта любого дома (даже собственного), возвращая ошибку `ERR_SPELL_TARGET_BLOCKED_BY_HOUSE`.

#### Scenario: Attempting to mark a recall rune inside a house
- **WHEN** маг пытается скастовать заклинание `Mark` (круг 6), стоя внутри собственного или чужого дома
- **THEN** сервер прерывает эффект заклинания с кодом `ERR_SPELL_TARGET_BLOCKED_BY_HOUSE`

#### Scenario: Attempting to teleport onto a house balcony or roof
- **WHEN** игрок кастует заклинание `Teleport` (круг 3) и указывает курсором на тайл балкона, крыши или двора внутри футпринта дома
- **THEN** сервер отклоняет телепортацию с кодом `ERR_SPELL_TARGET_BLOCKED_BY_HOUSE`

### Requirement: Safe Instant Logout Inside Permitted Houses
Персонаж, находящийся внутри основного периметра дома (кроме внешних ступеней крыльца) и имеющий в этом доме роль `Owner`, `Co-Owner` или `Friend`, при отсутствии активного статуса агрессора или преступника SHALL выходить из мира мгновенно (`0` секунд задержки вместо стандартных `300` секунд). Посторонние посетители при логауте внутри чужого дома MUST оставаться в мире 300 секунд и при следующем входе выталкиваться к вывеске дома, если дом стал частным или они были забанены.

#### Scenario: Instant logout for house friend
- **WHEN** персонаж со статусом `Friend` и без активного боевого таймера разрывает соединение внутри комнаты дома
- **THEN** сервер немедленно удаляет аватар персонажа из мира и сохраняет его позицию внутри дома

#### Scenario: Intruder logging in inside a now-private house is ejected
- **WHEN** посторонний игрок вышел из игры внутри дома, который в его отсутствие перевели в режим `PRIVATE`
- **AND** игрок снова входит в игру этим персонажем
- **THEN** сервер спавнит персонажа снаружи дома на координатах `(signX, signY + 1, signZ)`

### Requirement: Character Deletion Guard for House Owners
Реализация хука защиты удаления персонажей (`CHARACTER_DELETION_GUARDS` из P05) SHALL блокировать удаление персонажа, если он является текущим владельцем (`Owner`) активного дома, возвращая ошибку `ERR_CHARACTER_OWNS_HOUSE`. Игрок MUST предварительно снести дом или передать права владения другому персонажу перед удалением.

#### Scenario: Rejecting deletion of a house-owning character
- **WHEN** аккаунт отправляет запрос на удаление персонажа, за которым числится активный дом в таблице `world_houses`
- **THEN** сервер отклоняет удаление с кодом `ERR_CHARACTER_OWNS_HOUSE`
