# Спецификация: housing/house-placement

## Purpose

Определяет правила каталога чертежей домов (House Deeds) эпохи UO:Renaissance, клиентского превью установки мульти-структуры, геометрической и ландшафтной валидации строительной площадки, ограничения одного дома на аккаунт и атомарной фиксации постройки в базе данных. Гарантирует защиту мира от застройки дорог, блокировки проходов и дюпа дидов.

## ADDED Requirements

### Requirement: House Deed Catalog and Capacity Tiers
Система SHALL поддерживать 18 канонических чертежей домов UO:R (от `small_stone_plaster_house` 7×7 за 43800 золота с 425 фиксациями и 3 сундуками до `castle` 31×31 за 1022850 золота с 4879 фиксациями и 28 сундуками). Каждый дид MUST иметь вес 1.0 камень, флаг `Newbied` (остаётся при смерти) и фиксированный `multiId`.

#### Scenario: Inspecting a canonical house deed in backpack
- **WHEN** игрок получает или покупает у NPC Architect дид `two_story_villa`
- **AND** запрашивает свойства предмета
- **THEN** сервер возвращает цену 136500 золота, размер площадки 11×11 тайлов, лимит 1100 фиксаций, 8 защищённых сундуков и флаг `Newbied = true`

#### Scenario: Rejecting unknown or tampered house template
- **WHEN** клиент отправляет запрос активации дида с несуществующим `templateId`
- **THEN** сервер отклоняет операцию с кодом `ERR_HOUSE_INVALID_TEMPLATE` без удаления предмета

### Requirement: Ghost Multi Placement Preview
При двойном клике по диду дома в рюкзаке сервер SHALL переводить клиент в режим превью установки с передачей `multiId` и смещений футпринта. Клиент MUST отображать полупрозрачный силуэт дома, привязанный к тайловой сетке под курсором, и отправлять серверу выбранную координату центра `(facetId, x, y, z)` при клике левой кнопкой мыши.

#### Scenario: Activating placement preview from backpack
- **WHEN** игрок дважды кликает по диду дома, находящемуся в его основном рюкзаке
- **THEN** сервер открывает сессию таргетинга `HOUSE_PLACEMENT_TARGET` с таймаутом 30 секунд и параметрами футпринта мульти

#### Scenario: Denying preview when deed is not in backpack
- **WHEN** игрок пытается активировать дид дома, лежащий на земле, в банковской ячейке или в чужом контейнере
- **THEN** сервер отклоняет действие с кодом `ERR_HOUSE_DEED_MUST_BE_IN_BACKPACK`

### Requirement: Terrain Slopes and Surface Validity Check
Сервер SHALL проверять все тайлы основного футпринта дома `(W × H)` на ровность и тип поверхности. Перепад высот между любыми двумя тайлами площадки MUST быть $\Delta Z \le 5$ единиц, а наличие тайлов воды, скал, лавы, болот, пещерного пола или статических препятствий (`Impassable` или `Surface` выше базового `Z`) MUST блокировать постройку с кодом `ERR_HOUSE_INVALID_TERRAIN`.

#### Scenario: Placement fails on steep hill slope
- **WHEN** игрок выбирает точку установки, где минимальная высота тайла под домом равна `Z = 10`, а максимальная `Z = 18` ($\Delta Z = 8 > 5$)
- **THEN** сервер отклоняет постройку с кодом `ERR_HOUSE_INVALID_TERRAIN` и сохраняет дид в рюкзаке

#### Scenario: Placement fails over water or impassable rock
- **WHEN** хотя бы один тайл футпринта дома пересекает водный тайл или непроходимую статическую скалу
- **THEN** сервер возвращает ошибку `ERR_HOUSE_INVALID_TERRAIN`

### Requirement: Front Yard South Clearance and Obstacle Buffer
Площадка установки SHALL требовать свободную буферную зону: минимум 1 тайл по бокам и сзади (`N, E, W`) и минимум 4 тайла к югу перед фасадом (`S`) без деревьев, статических стен, заборов, спавнеров и динамических блокирующих предметов. До соседних домов MUST соблюдаться дистанция не менее 1 тайла по бокам и не менее 5 тайлов по оси север-юг с кодом `ERR_HOUSE_CLEARANCE_BLOCKED`.

#### Scenario: Blocked front porch clearance
- **WHEN** в 3 тайлах к югу от ступеней устанавливаемого дома находится статическое дерево или забор другого дома
- **THEN** сервер отклоняет установку с кодом `ERR_HOUSE_CLEARANCE_BLOCKED`

#### Scenario: Dynamic mobile or item standing inside footprint
- **WHEN** внутри основного футпринта дома находится другой игрок, NPC, приручённый питомец или предмет на земле
- **THEN** сервер отклоняет установку с кодом `ERR_HOUSE_FOOTPRINT_OCCUPIED`

### Requirement: Region Road and Guard Zone Placement Restrictions
Система SHALL запрещать установку домов на тайлах дорог (по списку дорожных `landTileId` и `staticTileId`) и в запретных зонах порта `IHousingRegionPolicy` (охраняемые города, подземелья, `NoHousing`, 16 тайлов от лунных врат и входов в данжи), возвращая `ERR_HOUSE_RESTRICTED_REGION`. Реализация порта по умолчанию MUST использовать охраняемые зоны P17 и статический список запретных прямоугольников контента; P25 заменяет её региональной.

#### Scenario: Attempting placement on a paved or dirt road
- **WHEN** футпринт дома или его 1-тайловый контур касается тайла дороги
- **THEN** сервер отклоняет установку с кодом `ERR_HOUSE_ON_ROAD`

#### Scenario: Attempting placement inside town guard zone
- **WHEN** игрок пытается поставить дом в границах охраняемого региона города или подземелья
- **THEN** сервер возвращает ошибку `ERR_HOUSE_RESTRICTED_REGION`

### Requirement: One House Per Account Ownership Limit
Каждый игровой аккаунт с уровнем доступа `Player` SHALL владеть не более чем одним домом одновременно на одном шарде (суммарно по всем персонажам аккаунта и всем фасетам). Попытка установить или принять в дар второй дом без статуса совладельца MUST отклоняться с кодом `ERR_HOUSE_ACCOUNT_LIMIT_REACHED`.

#### Scenario: Second character on same account tries to place a house
- **WHEN** у персонажа А на аккаунте уже есть активный дом в Trammel
- **AND** персонаж Б того же аккаунта пытается установить дом в Felucca
- **THEN** сервер отклоняет установку с кодом `ERR_HOUSE_ACCOUNT_LIMIT_REACHED`

#### Scenario: Co-ownership does not block owning a primary house
- **WHEN** персонаж числится только в списке `Co-Owners` или `Friends` чужого дома и не владеет собственным домом на аккаунте
- **THEN** сервер разрешает ему установить собственный дом

### Requirement: Atomic Placement Commit and Deed Consumption
При успешной проверке площадки сервер SHALL в единой синхронной транзакции (`RPO = 0`) изъять дид дома из рюкзака, создать запись дома со стадией `LIKE_NEW`, выдать два медных мастер-ключа (один в рюкзак, один в банковскую ячейку владельца), записать событие `HOUSE_PLACE` в `item_ledger` и разослать спавн мульти всем клиентам в радиусе 31 тайла.

#### Scenario: Successful house construction and key delivery
- **WHEN** все проверки площадки и лимита аккаунта пройдены успешно
- **THEN** дид исчезает, дом мгновенно появляется в мире, а владелец получает ключ в рюкзак и дубликат ключа в банк с одинаковым `lockId`

#### Scenario: Transaction rollback on concurrent placement race
- **WHEN** два игрока одновременно кликают установку дома на пересекающихся координатах в одном тике
- **THEN** первый запрос фиксируется, а второй получает `ERR_HOUSE_CLEARANCE_BLOCKED` без потери дида

### Requirement: New House Redeeding Penalty and Cooldown
После успешной установки дома на аккаунт SHALL накладываться 7-дневный таймер ограничения новой постройки (`168` реальных часов). Если владелец сносит дом в первые 168 часов после постройки, система MUST возвращать вместо дида банковский чек на `80%` номинальной стоимости дида (удерживая 20% налога как вывод золота `SINK_HOUSE_EARLY_REDEED`).

#### Scenario: Early demolition within seven days refunds eighty percent gold
- **WHEN** игрок сносит дом стоимостью 100000 золота через 48 часов после установки
- **THEN** сервер выдаёт в банк чек на 80000 золота и записывает 20000 золота в телеметрию `SINK_HOUSE_EARLY_REDEED`

#### Scenario: Placement cooldown blocks immediate re-placement
- **WHEN** игрок снёс или передал дом менее чем 168 часов назад с момента последней постройки
- **AND** пытается установить новый дом из дида
- **THEN** сервер отклоняет установку с кодом `ERR_HOUSE_PLACEMENT_COOLDOWN` и указывает оставшееся время
