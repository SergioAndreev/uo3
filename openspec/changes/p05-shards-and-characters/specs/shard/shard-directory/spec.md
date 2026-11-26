# Спецификация: shard/shard-directory

## Purpose

Каталог шардов Duskmarch: реестр в PostgreSQL, живое состояние из heartbeat игровых узлов в Valkey, правила шарда (пресет профиля, планы, слоты героев), видимость по уровню доступа, режимы обслуживания и совместимость версий протокола.

## ADDED Requirements

### Requirement: Каталог публичных шардов
Система MUST отдавать по `GET /api/v1/shards` без аутентификации список шардов с видимостью `public` и статусом не `archived`, упорядоченный по `sortOrder`, затем по `id`. Каждый элемент SHALL содержать `id`, `name`, `region`, `preset`, включённые планы, `characterSlots`, эффективный статус, индикатор загрузки и `protocolRange`.

#### Scenario: Список без аутентификации
- **WHEN** анонимный клиент запрашивает каталог при двух публичных шардах и одном архивном
- **THEN** система возвращает HTTP `200 OK` с двумя шардами в порядке `sortOrder`

#### Scenario: Устойчивый порядок при равном sortOrder
- **WHEN** два шарда имеют одинаковый `sortOrder`
- **THEN** они упорядочены по `id`

### Requirement: Персональный контекст игрока
При действующем Access JWT каждый элемент каталога SHALL содержать `myCharacters` (число героев аккаунта на шарде) и `canEnter` с причиной отказа `entryBlockedReason` (`maintenance`, `full`, `offline`, `staff_only`). Просроченный токен MUST отклоняться с HTTP `401` и кодом `AUTH_TOKEN_EXPIRED`, а не трактоваться как анонимный запрос.

#### Scenario: Число героев игрока
- **WHEN** игрок с двумя героями на шарде `ember` запрашивает каталог
- **THEN** элемент `ember` содержит `myCharacters: 2`

#### Scenario: Вход закрыт обслуживанием
- **WHEN** шард в режиме `maintenance`, а запрос делает `player`
- **THEN** элемент содержит `canEnter: false` и `entryBlockedReason: 'maintenance'`

#### Scenario: Просроченный токен
- **WHEN** запрос несёт истёкший Access JWT
- **THEN** система отвечает HTTP `401` с кодом `AUTH_TOKEN_EXPIRED`

### Requirement: Видимость служебных шардов
Шард с видимостью `staff` SHALL показываться только персоналу (`helper` и выше) с `mfa: true`; шард `unlisted` не попадает в список, но доступен по точному `id`. Для остальных запросов скрытый шард MUST отвечать как несуществующий (`SHARD_NOT_FOUND`, `404`).

#### Scenario: Служебный шард скрыт от игрока
- **WHEN** `player` запрашивает каталог при наличии шарда `staff`
- **THEN** шард отсутствует в ответе, а `GET /api/v1/shards/{id}` отвечает `404 SHARD_NOT_FOUND`

#### Scenario: Служебный шард виден персоналу
- **WHEN** `moderator` с `mfa: true` запрашивает каталог
- **THEN** служебный шард присутствует в ответе

#### Scenario: Шард по ссылке
- **WHEN** анонимный клиент запрашивает шард `unlisted` по точному `id`
- **THEN** система возвращает его карточку, но в общем списке его нет

### Requirement: Карточка шарда и сводка правил
`GET /api/v1/shards/{id}` SHALL возвращать сводку правил шарда: пресет и отпечаток публичного профиля правил P01, включённые планы с режимом PvP (`consent` — Заря, `open` — Марь), флаги функций, `characterSlots`, стартовые города и диапазон версий протокола.

#### Scenario: Шард с Зарёй и Марью
- **WHEN** запрашивается шард с включённым флагом `realmDusk`
- **THEN** сводка содержит планы `dawn` (`pvp: consent`) и `dusk` (`pvp: open`)

#### Scenario: Шард только с Зарёй
- **WHEN** запрашивается шард с выключенным `realmDusk`
- **THEN** сводка содержит только план `dawn`

#### Scenario: Несуществующий шард
- **WHEN** запрашивается неизвестный `id`
- **THEN** система отвечает HTTP `404` с кодом `SHARD_NOT_FOUND`

### Requirement: Живое состояние из heartbeat
Игровые узлы MUST публиковать heartbeat в Valkey не реже раза в 5 секунд с TTL 15 секунд. Каталог SHALL суммировать `onlineCount` по живым узлам и выводить статус: `offline` — нет живых узлов; `degraded` — у узла `tickP99Ms` выше 75 мс; `draining` — все узлы в дренаже; иначе `online`. Ручные режимы `maintenance` и `draining` из реестра имеют приоритет.

#### Scenario: Сумма онлайна по узлам
- **WHEN** два узла шарда сообщают `onlineCount` 120 и 80
- **THEN** каталог показывает `onlineCount: 200` и статус `online`

#### Scenario: Потеря сигналов
- **WHEN** heartbeat узлов не обновлялся 15 секунд
- **THEN** шард получает статус `offline`

#### Scenario: Деградация тика
- **WHEN** один из узлов сообщает `tickP99Ms: 90`
- **THEN** шард получает статус `degraded`

### Requirement: Индикатор загрузки и предел вместимости
Загрузка SHALL вычисляться как `(online + reserved) / softCapacity`: `low` < 50 %, `medium` < 80 %, `high` < 100 %, `full` ≥ 100 %. При `full` вход `player` MUST отклоняться; персонал может войти в пределах `staffBuffer` сверх `hardCapacity`.

#### Scenario: Загрузка 85 %
- **WHEN** `softCapacity` 1000, онлайн 800 и 50 резервов
- **THEN** индикатор равен `high`

#### Scenario: Полный шард для игрока
- **WHEN** онлайн с резервами достиг `hardCapacity`
- **THEN** `player` получает `canEnter: false` и `entryBlockedReason: 'full'`

#### Scenario: Буфер персонала
- **WHEN** шард заполнен, а вход запрашивает `game-master` в пределах `staffBuffer`
- **THEN** `canEnter` равно `true`

### Requirement: Обслуживание и дренаж
Администратор с разрешением `shard.manage` SHALL переводить шард в `maintenance` (с необязательным `etaAt` и сообщением) и в `draining`. Переход MUST публиковать событие `shard.status_changed` и отзывать непогашенные тикеты игроков. В `maintenance` входят только `game-master` и выше; в `draining` новые входы закрыты для всех.

#### Scenario: Обслуживание с ETA
- **WHEN** администратор переводит шард в `maintenance` с `etaAt`
- **THEN** карточка показывает статус `maintenance` и `etaAt`, событие опубликовано

#### Scenario: Ведущий входит при обслуживании
- **WHEN** шард в `maintenance`, вход запрашивает `game-master`
- **THEN** `canEnter` равно `true`, а для `moderator` — `false`

#### Scenario: Дренаж
- **WHEN** шард в `draining`
- **THEN** новые тикеты не выдаются никому (`SHARD_DRAINING`, `503`)

### Requirement: Совместимость версий протокола
Клиент MAY передавать заголовок `X-Duskmarch-Protocol` в формате semver. Каталог SHALL помечать каждый шард `compatible: true|false` по `protocolRange` шарда; некорректный заголовок MUST отклоняться с HTTP `400` и кодом `SHARD_PROTOCOL_HEADER_INVALID`.

#### Scenario: Совместимая версия
- **WHEN** клиент `1.2.0`, диапазон шарда `>=1.0.0 <2.0.0`
- **THEN** шард помечен `compatible: true`

#### Scenario: Устаревшая версия
- **WHEN** клиент `0.9.0`
- **THEN** шард помечен `compatible: false`, а выдача тикета отвечает `426` с кодом `SHARD_PROTOCOL_INCOMPATIBLE`

#### Scenario: Некорректный заголовок
- **WHEN** заголовок равен `latest`
- **THEN** система отвечает `400 SHARD_PROTOCOL_HEADER_INVALID`

### Requirement: Кэширование и деградация
Анонимный ответ каталога SHALL содержать слабый `ETag`; запрос с совпадающим `If-None-Match` MUST получать `304`. При недоступности Valkey каталог SHALL отвечать по данным реестра со статусом шардов `unknown` и заголовком `Warning`, не возвращая `5xx`.

#### Scenario: 304 по ETag
- **WHEN** клиент повторяет запрос с полученным `ETag` и состояние не изменилось
- **THEN** система отвечает `304 Not Modified`

#### Scenario: Valkey недоступен
- **WHEN** чтение heartbeat завершается ошибкой
- **THEN** каталог отвечает `200` со статусом `unknown` у каждого шарда

### Requirement: Административное управление реестром
Создание и изменение шардов SHALL требовать разрешения `shard.manage` и записываться в аудит. Смена `preset` или отключение плана у шарда, где уже есть герои, MUST отклоняться с HTTP `409` и кодом `SHARD_RULES_LOCKED`.

#### Scenario: Регистрация шарда
- **WHEN** администратор создаёт шард `ember` с пресетом `standard`
- **THEN** шард появляется в реестре со статусом `offline` до первого heartbeat, запись аудита создана

#### Scenario: Запрет смены правил с героями
- **WHEN** администратор меняет пресет шарда, где есть герои
- **THEN** система отвечает `409 SHARD_RULES_LOCKED`

#### Scenario: Не-администратор
- **WHEN** `game-master` вызывает создание шарда
- **THEN** система отвечает `403 RBAC_INSUFFICIENT_PERMISSION`
