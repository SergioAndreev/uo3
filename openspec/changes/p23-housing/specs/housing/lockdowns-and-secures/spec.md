# Спецификация: housing/lockdowns-and-secures

## Purpose

Определяет механику управления интерьером дома через канонические голосовые команды, правила фиксации предметов (Lockdowns) и защищённых сундуков (Secure Containers), математическую формулу общего бюджета хранения, установку и разборку крафтовых аддонов (Add-on Deeds из P20), работу мусорной бочки и политику размещения вендоров игроков (P21).

## ADDED Requirements

### Requirement: Verbal Commands Inside House Bounds
Сервер SHALL перехватывать в `SpeechRouter` ключевые фразы игрока, находящегося внутри периметра дома с ролью `Owner` или `Co-Owner`: `I wish to lock this down`, `I wish to release this`, `I wish to secure this`, `I wish to unsecure this` и `I wish to place a trash barrel`. Для роли `Friend` эти команды MUST отклоняться с кодом `ERR_HOUSE_INSUFFICIENT_PERMISSION`.

#### Scenario: Co-owner triggers lockdown targeting cursor via speech
- **WHEN** совладелец дома произносит `I wish to lock this down`, стоя внутри комнаты дома
- **THEN** сервер открывает для него курсор выбора предмета `HOUSE_LOCKDOWN_TARGET` с таймаутом 30 секунд

#### Scenario: Friend denied lockdown verbal command
- **WHEN** персонаж с ролью `Friend` произносит `I wish to lock this down` внутри дома
- **THEN** сервер не открывает курсор и отправляет системное сообщение с кодом `ERR_HOUSE_INSUFFICIENT_PERMISSION`

### Requirement: Item Lockdown Mechanics and Immobility
При применении команды `I wish to lock this down` на незафиксированный предмет, лежащий на полу или на поверхности внутри дома (кроме дверей и тайлов крыльца), сервер SHALL помечать предмет флагом `isLockedDown = true` и отображать в его тултипе статус `[Locked Down]`. Зафиксированный предмет MUST быть защищён от поднятия (`PickUp`) любым игроком, от сдвига и от распада; если это обычный контейнер, его содержимое доступно для просмотра всем посетителям, но сам контейнер нельзя унести.

#### Scenario: Locking down a decorative item on house floor
- **WHEN** владелец применяет курсор фиксации на предмет внутри дома при наличии свободного лимита `usedLockdowns < maxLockdowns`
- **THEN** предмет получает флаг `isLockedDown = true`, счётчик `usedLockdowns` увеличивается на `1` (плюс количество вложенных предметов, если это контейнер), а попытка поднять предмет возвращает `ERR_ITEM_LOCKED_DOWN`

#### Scenario: Releasing a locked down item
- **WHEN** владелец или совладелец применяет `I wish to release this` на зафиксированный предмет
- **THEN** флаг `isLockedDown` снимается, счётчик `usedLockdowns` уменьшается, и предмет снова можно свободно перемещать

### Requirement: Secure Container Registration and Access Tiers
Владелец или совладелец SHALL иметь возможность превратить любой незафиксированный контейнер на полу внутри дома в защищённый сундук командой `I wish to secure this`. Защищённый сундук MUST вмещать до `125` предметов и `400` камней веса, быть полностью неподвижным и поддерживать 4 уровня доступа (`OWNER_ONLY`, `CO_OWNERS`, `FRIENDS`, `ANYONE`), проверяемых через `ContainerAccessGrantPort`.

#### Scenario: Securing a wooden chest and setting friend access
- **WHEN** владелец применяет `I wish to secure this` на сундук внутри дома при `usedSecures < maxSecures` и достаточном запасе бюджета фиксаций
- **THEN** сундук регистрируется как `Secure Container`, открывается мини-гамп выбора уровня доступа, и при выборе `FRIENDS` только владелец, совладельцы и друзья могут открывать и брать предметы из сундука

#### Scenario: Blocking unauthorized player from opening a secure chest
- **WHEN** посторонний посетитель дважды кликает по защищённому сундуку с уровнем доступа `CO_OWNERS`
- **THEN** сервер отклоняет открытие контейнера с кодом `ERR_HOUSE_SECURE_ACCESS_DENIED`

### Requirement: Shared Storage Capacity Budget Formula
Каждый шаблон дома SHALL иметь фиксированный общий пул хранения `maxLockdowns` и лимит сундуков `maxSecures`. Каждый зарегистрированный защищённый сундук MUST резервировать ровно `125` единиц из общего пула `maxLockdowns`, так что доступный остаток для одиночных фиксаций вычисляется по формуле `availableLockdowns = maxLockdowns - (usedSecures * 125) - currentLockdownItems`.

#### Scenario: Securing a chest consumes 125 points from lockdown pool
- **WHEN** в доме `small_stone_plaster_house` (`maxLockdowns = 425`, `maxSecures = 3`) уже установлено 2 защищённых сундука (`250` единиц) и зафиксировано 100 предметов
- **AND** владелец пытается установить 3-й защищённый сундук (требующий ещё 125 единиц при остатке `425 - 350 = 75`)
- **THEN** сервер отклоняет установку сундука с кодом `ERR_HOUSE_STORAGE_CAPACITY_EXCEEDED`

#### Scenario: Unsecuring a chest restores 125 lockdown budget points
- **WHEN** владелец применяет `I wish to unsecure this` на пустой или частично заполненный защищённый сундук
- **THEN** статус `Secure` снимается, а доступный бюджет `availableLockdowns` увеличивается на `125`

### Requirement: Crafted House Add-on Placement and Chop Redeeding
Владелец или совладелец SHALL иметь возможность установить внутри дома крафтовый аддон из дида (наковальню, горн, станок, кровать, печь, манекен). Аддон MUST размещаться только на внутренних тайлах пола и не перекрывать радиус 1 шага от дверей (`ERR_HOUSE_ADDON_BLOCKS_DOOR`). Удар топором по аддону владельцем или совладельцем MUST разбирать его обратно в дид в рюкзак.

#### Scenario: Placing a blacksmith forge add-on inside house
- **WHEN** совладелец использует `Forge Deed` в рюкзаке и указывает на свободный внутренний тайл дома вдали от дверей
- **THEN** дид потребляется, а на указанном тайле создаются неподвижные компоненты горна, привязанные к `houseId`

#### Scenario: Chopping an add-on with an axe returns the deed
- **WHEN** владелец дома использует экипированный топор на установленную наковальню внутри своего дома
- **THEN** компоненты наковальни удаляются из мира, а в рюкзаке владельца создаётся `Anvil Deed`

### Requirement: Interior Ground Item Decay Exemption
Предметы внутри периметра дома, имеющие статус `isLockedDown = true`, `isSecure = true` или `isAddonComponent = true`, SHALL быть полностью освобождены от таймера распада предметов на земле. Обычные незафиксированные предметы, брошенные на пол внутри дома, MUST распадаться по стандартному 60-минутному таймеру (`3600` секунд из P13), чтобы предотвратить обход лимитов `maxLockdowns`.

#### Scenario: Locked down item never decays on house floor
- **WHEN** зафиксированный меч лежит на полу дома более 60 минут
- **THEN** сервер пропускает его при проверке распада предметов, и меч остаётся в доме бессрочно, пока дом не обрушится

#### Scenario: Unsecured item dropped on house floor decays after 60 minutes
- **WHEN** игрок бросает на пол дома незафиксированный предмет и не применяет к нему `lock down` в течение 3600 секунд
- **THEN** предмет удаляется по стандартному таймеру распада на земле

### Requirement: Trash Barrel Installation and Three-Minute Purge
Владелец, совладелец или друг SHALL иметь возможность установить внутри дома не более одной мусорной бочки (`Trash Barrel`, `itemId = 0x0E77`, цвет `0x03B2`) командой `I wish to place a trash barrel`. Любой предмет, помещённый внутрь мусорной бочки, MUST запускать 3-минутный таймер (`180` секунд), по истечении которого все предметы в бочке безвозвратно уничтожаются с записью в телеметрию; удар топором по бочке владельцем или совладельцем удаляет саму бочку.

#### Scenario: Trash barrel purges items after three minutes
- **WHEN** игрок кладёт ненужный предмет в `Trash Barrel` внутри дома
- **THEN** бочка сообщает, что предмет будет удалён через 3 минуты, и ровно через 180 секунд безвозвратно уничтожает всё своё содержимое

#### Scenario: Rejecting second trash barrel in the same house
- **WHEN** в доме уже установлена одна мусорная бочка
- **AND** совладелец повторно произносит `I wish to place a trash barrel`
- **THEN** сервер отклоняет установку с кодом `ERR_HOUSE_TRASH_BARREL_EXISTS`

### Requirement: Player Vendor Placement Delegation Policy
Реализация порта `IVendorPlacementPolicy` (из P21) SHALL разрешать установку `Contract of Employment` (вендора игрока) только на внутреннем тайле или крыльце дома, находящегося в режиме `PUBLIC`, и только персонажам с ролью `Owner`, `Co-Owner` или `Friend` этого дома. Суммарное количество вендоров в доме MUST NOT превышать лимит шаблона дома (`maxVendors`, равный `maxSecures * 2`), а на одном тайле не может стоять более одного вендора (`ERR_HOUSE_VENDOR_LIMIT_REACHED`).

#### Scenario: Friend places a player vendor in a public house
- **WHEN** персонаж с ролью `Friend` активирует `Contract of Employment`, стоя внутри дома со статусом `PUBLIC` и свободным лимитом `usedVendors < maxVendors`
- **THEN** `IVendorPlacementPolicy` возвращает разрешение, и вендор спавнится с привязкой к `houseId`

#### Scenario: Rejecting vendor placement in a private house
- **WHEN** владелец пытается установить вендора из контракта внутри дома, находящегося в режиме `PRIVATE`
- **THEN** сервер отклоняет установку с кодом `ERR_HOUSE_MUST_BE_PUBLIC_FOR_VENDORS`
