# Сетевой код и репликация

Фаза P07. Контракт — спецификации `openspec/specs/netcode/*`; опкоды и коды закрытия — [реестр протокола](../../../docs/PROTOCOL_REGISTRY.md).

## Устройство

| Модуль | Содержимое |
|---|---|
| `packages/protocol/src/netcode` | Опкоды `0x0001..0x0008`, коды ошибок `PROTO_*`/`CMD_*`/`NET_*`, схемы `session.hello`/`welcome`, `time.ping`/`pong`, `cmd.error`; каталог намерений `BASE_INTENTS` и проверка `checkIntent` |
| `packages/protocol/src/state` | Классы `@colyseus/schema`: `ReplicatedBeing`, `ReplicatedItem`, `ReplicatedStructure`, `ReplicatedContainerItem`, `PrivateHeroState`, `PartitionState`, `HubState` |
| `packages/protocol/src/time` | `ClockSync` и `LinkQuality` — модель часов и качества связи клиента |
| `src/netcode/handshake.ts` | Согласование версии, сверка мира и патчей, `session.welcome` |
| `src/netcode/router.ts` | `IntentRouter` и `NetSession`: проверка намерения до очереди тика, права, состояние героя, частота, окно шагов, очередь 32 на тик, флуд-контроль, таймауты |
| `src/netcode/interest.ts` | `InterestManager`: секторы 16×16, вход `≤ R`, выход `> R + H`, предикаты, лимиты 512/1 024, контейнеры, ресинхронизация |
| `src/netcode/projection.ts` | `ProjectionSync`: ядро → состояние схемы, `StateView` на клиента, приватное — только владельцу, отношения по наблюдателю |
| `src/netcode/replication.ts` | `ReplicationScheduler`: приоритеты P0..P3, бюджет трафика, всплеск, защита от голодания, метрики |
| `src/netcode/events.ts` | `EventChannel`: немедленные события с фильтром видимости и дальности, обратное давление, `4130` |
| `src/netcode/time-sync.ts` | Ответ на `time.ping` вне тика, серверная оценка RTT по ping/pong WebSocket |
| `src/netcode/partition-net.ts`, `hub-net.ts` | Сборка слоя для комнаты партиции и хаба |
| `apps/client/src/net` | `NetClient`: комнаты, рукопожатие, зонды времени, переподключение по токену |

## Подключение

1. Вход по билету P05 (`onJoin` P06).
2. В течение 5 с — `session.hello { protocolVersion, rulesetFingerprint, worldVersion, patchIds? }`.
3. Ответ `session.welcome`: согласованная версия, `compatibility` (`OK` или `PATCH_DIFF_WARNING` с `missingPatchIds`), публичный срез правил и его отпечаток, версия мира, тик и серверное время.
4. До `welcome` намерения отклоняются `PROTO_HANDSHAKE_REQUIRED`.

| Отказ | Ошибка | Закрытие |
|---|---|---|
| Другой MAJOR, версия ниже минимальной или MINOR новее сервера | `PROTO_VERSION_UNSUPPORTED` | `4111` |
| Другая версия мира | `PROTO_WORLD_DATA_INCOMPATIBLE` | `4107` |
| Нет `hello` за 5 с | `PROTO_HANDSHAKE_TIMEOUT` | `4129` |
| 30 с без сообщений | `NET_HEARTBEAT_TIMEOUT` | `4131` |
| 20 нарушений протокола за 10 с | `PROTO_MALFORMED_FLOOD` | `4100` |
| 50 отказов по частоте за 10 с | `PROTO_RATE_LIMIT_EXCEEDED` | `4108` |
| Буфер > 256 КиБ 5 с или > 512 КиБ | `NET_SLOW_CONSUMER` | `4130` |

## Тик

Намерения ставятся в очередь планировщика P06 и исполняются в порядке `(enqueuedTick, sessionOrder, sequence)`. Обработчик намерения регистрирует фаза, которая его реализует (`router.handle(name, handler)`); без обработчика — `CMD_HANDLER_UNAVAILABLE`. В конце тика (`onPostTick`) партиция выполняет: таймауты → область интереса → проекция с учётом приоритетов → метаданные → пакеты событий; затем комната вызывает `broadcastPatch()` (автоматическая частота патчей Colyseus отключена).

## Приоритеты

Объекты схемы общие для всех наблюдателей, поэтому частота применяется к сущности: берётся самый частый интервал среди её наблюдателей с учётом их нагрузки. P0 (свой герой, приватное) — каждый тик; P1 (≤ 12 клеток, цели, группа) — 20→10 Гц; P2 (13..18, предметы ≤ 12) — 10→5 Гц; P3 (дальние предметы, постройки) — 4→2 Гц. Деградация растёт ступенями при превышении бюджета 16 КиБ/с (после входа и телепорта 3 с допускается 48 КиБ/с). Ожидание дольше 500 мс — отправка вне очереди.

## Ограничения до следующих фаз

- Внешность, ресурсы и отношения героев приходят из портов `NetContext` (`heroView`, `heroPrivate`, `relations`); до P09/P15/P17 — значения по умолчанию.
- Ключи контента существ и предметов в ядре P06 нет — модель заполняется заглушкой до P13/P19.
- Свет и сезон партиции задаёт P25 через `ProjectionSync.setMeta`.
