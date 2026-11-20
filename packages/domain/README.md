# `@uo3/domain` — Общая доменная модель UO3

Строго изоморфное и детерминированное доменное ядро UO3 (эпоха **Ultima Online: Renaissance**, ADR-001 / ADR-006 / ADR-010). Работает побитово идентично в Node.js 22 ESM и браузерной среде (Vite 6 + Web Workers).

## Архитектурные инварианты и границы изоморфности

- **Нулевые зависимости от других `@uo3/*` пакетов** (`@uo3/domain` — корневой слой DAG).
- **Единственная внешняя runtime-зависимость:** `@sinclair/typebox` (для скомпилированных схем валидации).
- **Запрещены:** `node:*`, DOM-глобалы (`window`, `document`, `localStorage`, `sessionStorage`), а также недетерминированные вызовы `Math.random()`, `Date.now()`, `new Date()` без аргументов, `performance.now()` и `process.env` (контролируется ESLint-правилом `uo3/domain-rules-determinism` и `dependency-cruiser`; единственное документированное исключение — `src/runtime/system-clock.ts`).
- **Нулевой runtime-оверхед типов:** доменные идентификаторы (`Serial`, `MobileSerial`, `ItemSerial`, `FacetId`, `BodyId`, `Hue`, `LandId`, `ItemId`, `MultiId`, `SkillId`, `SkillTenths`, `TileFlags`) реализованы как брендированные примитивы поверх `number`/`bigint`.

## Точки экспорта (ESM subpaths)

| Subpath                   | Назначение                                                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@uo3/domain`             | Корневой реэкспорт всех публичных типов, функций и констант                                                                                                                               |
| `@uo3/domain/errors`      | `DomainError`, `DomainErrorCode`, `isDomainError`, `deepFreeze`                                                                                                                           |
| `@uo3/domain/identity`    | 32-битные серийники, классификаторы, `SerialAllocator`, `SerialRegistry`, `EphemeralSerialAllocator`, TypeBox-схемы                                                                       |
| `@uo3/domain/coordinates` | `Point2D`/`Point3D`/`Rect2D`/`WorldLocation`, фасеты, сектора `16×16`, блоки `8×8`, `Direction`, расстояния, изометрическая проекция, зазоры                                              |
| `@uo3/domain/enums`       | `Layer`, `BodyId`, `Hue`, `Race`, `Gender`, `Notoriety`, `AccessLevel`, `SkillId` (49 навыков UO:R), `StatId`, `LockState`, `TileFlags` (64-bit `bigint`), `LandTileData`, `ItemTileData` |
| `@uo3/domain/runtime`     | `GameClock`, `SystemGameClock`, `SeededRng` (`xoshiro128++` + `SplitMix64`), игровое время UO, фазы суток, глобальная освещённость (`0..26`) и фазы лун                                   |

## Реестр кодов ошибок (`DomainErrorCode`)

| Категория                      | Коды ошибок                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `domain/entity-identity`       | `ERR_INVALID_SERIAL`, `ERR_SERIAL_KIND_MISMATCH`, `ERR_SERIAL_COLLISION`, `ERR_SERIAL_RANGE_EXHAUSTED`, `ERR_INVALID_LEASE_SIZE`, `ERR_RESERVED_SERIAL`                                                                                                                                                                        |
| `domain/world-coordinates`     | `ERR_INVALID_COORDINATE`, `ERR_Z_OUT_OF_RANGE`, `ERR_UNKNOWN_FACET`, `ERR_INVALID_FACET_DIMENSIONS`, `ERR_OUT_OF_MAP_BOUNDS`, `ERR_UNALIGNED_PARTITION_BOUNDS`, `ERR_INVALID_DIRECTION`, `ERR_FACET_MISMATCH`                                                                                                                  |
| `domain/core-enumerations`     | `ERR_INVALID_LAYER`, `ERR_INVALID_BODY`, `ERR_INVALID_HUE`, `ERR_HUE_OUT_OF_ALLOWED_RANGE`, `ERR_INVALID_NOTORIETY`, `ERR_INVALID_ACCESS_LEVEL`, `ERR_RACE_DISABLED_IN_ERA`, `ERR_INVALID_GENDER`, `ERR_INVALID_GRAPHIC_ID`, `ERR_INVALID_TILE_FLAGS`, `ERR_INVALID_SKILL_ID`, `ERR_INVALID_STAT_ID`, `ERR_INVALID_LOCK_STATE` |
| `domain/ruleset-profile`       | `ERR_UNKNOWN_FEATURE_FLAG`, `ERR_RULESET_UNKNOWN_KEY`, `ERR_RULESET_INVARIANT_VIOLATION`, `ERR_UNKNOWN_RULESET_PRESET`, `ERR_NON_PROD_PRESET_FORBIDDEN`, `ERR_INVALID_STAT_VALUE`                                                                                                                                              |
| `domain/deterministic-runtime` | `ERR_CLOCK_BACKWARD_JUMP`, `ERR_INVALID_TIME_DELTA`, `ERR_INVALID_RNG_SEED`, `ERR_INVALID_RANGE`, `ERR_INVALID_PROBABILITY`, `ERR_EMPTY_COLLECTION`, `ERR_INVALID_WEIGHT`, `ERR_INVALID_RNG_STATE`, `ERR_INVALID_GAME_TIME_PARAM`                                                                                              |

## Документация подсистем

- `docs/entity-identity.md` — серийники, диапазоны, wire-кодеки и контракт блочной аренды
- `docs/world-coordinates.md` — координаты, фасеты, сектора `16×16`, направления, изометрия и зазоры
- `docs/core-enumerations.md` — таблицы `Layer`, `Body`, `Hue`, `Notoriety`, `AccessLevel`, 49 навыков и 64-битных `TileFlag`
- `docs/deterministic-runtime.md` — `GameClock`, `xoshiro128++`, игровое время и лунные фазы
