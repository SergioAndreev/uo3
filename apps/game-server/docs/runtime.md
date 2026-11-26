# Среда выполнения игрового сервера

Фаза P06. Контракт — спецификации `openspec/specs/runtime/*`.

## Устройство

| Каталог | Содержимое |
|---|---|
| `src/engine` | Ядро без ввода-вывода: `TimingWheel`, `Scheduler` (20 Гц, шесть фаз), `SpatialIndex`, `PartitionCore`, `SessionManager`, `HubCore` |
| `src/host` | `ShardNode` (партиции, хаб, события, heartbeat, обслуживание, остановка), порядок старта, адаптеры Valkey/NATS/PostgreSQL, точки появления и безопасные зоны мира |
| `src/rooms` | Комнаты Colyseus `WorldPartitionRoom` и `ShardHubRoom` — тонкие адаптеры к узлу |
| `src/testing` | `HeadlessShard`: шард в памяти для тестов фаз P07 и далее |

## Порядок старта

1. Конфигурация, профиль правил и мир (`WORLD_PACK_DIR` или синтетический `proving`).
2. Подключения PostgreSQL, Valkey, NATS; пробы на `GAME_HEALTH_PORT`.
3. Строка шарда `SHARD_ID` из PostgreSQL → профиль правил (как у API).
4. Партиции для планов профиля, мир которых загружен (в разработке — `local-dev` на `proving`).
5. Комнаты `{shard}-{realm}-0` и `{shard}-hub`, подписки `identity.account.>`, `character.>`, `shard.{id}.>`.
6. Планировщик, heartbeat каждые `GAME_HEARTBEAT_MS`, приём подключений.

Ошибки старта: `HOST_SHARD_MISMATCH`, `HOST_CONFIG_INVALID`, `HOST_BOOT_FAILED` (код выхода 1).

## Подключение клиента

- Партиция: `client.joinById('{shard}-{realm}-0', { ticket })` или `{ reconnect: { accountId, sessionId, token } }` — токен приходит заранее сообщением `0x0024`.
- Хаб: `client.joinById('{shard}-hub', { ticket })`.
- Сообщения — опкоды `0x0020..0x003F` (`RUNTIME_OPCODES`, реестр протокола). Отказ во входе приходит ошибкой подключения с кодом закрытия реестра (`4101`, `4124`, `4128` …).

## Пробы

`/health/live`, `/health/startup`, `/health/ready`, `/metrics` (текст Prometheus) и прежние `/healthz`, `/readyz`.

## Стенд для тестов

```ts
const shard = await HeadlessShard.create({ seed: 7 });
const { session, world, hub } = await shard.player('acc', { x: 40, y: 40 });
shard.partition.sessions.logout(session);
shard.advanceMs(120_000);
expect(shard.fingerprint()).toBe(/* … */);
```

Строгий режим запрещает `Date.now` и `Math.random` внутри тика. Снапшот — журнал действий; откат — новый шард с тем же сидом и повтором журнала.
