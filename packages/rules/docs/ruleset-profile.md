# `domain/ruleset-profile` — Профили эпох, константы UO:R и формулы (`@uo3/rules`)

Модуль `@uo3/rules` хранит канонический неизменяемый профиль эпохи **Ultima Online: Renaissance (`uor`)** (ADR-010, раздел 5 `docs/ARCHITECTURE.md`), реестр пресетов шарда, валидатор переопределений, синхронный изоморфный SHA-256 отпечаток и чистые базовые формулы.

## Канонические константы `UOR_CANONICAL_PROFILE` (`schemaVersion: "1.0.0"`)

| Секция | Параметр | Значение |
| --- | --- | --- |
| `geometry` | `tileWidthPx`, `tileHeightPx`, `zStepPx`, `sectorSizeTiles`, `personHeight`, `stepHeight` | `44`, `44`, `4`, `16`, `16`, `2` |
| `network` | `aoiRadiusTiles`, `multiAoiRadiusTiles`, `simTickMs`, `patchIntervalMs`, `moveSequenceMax`, `maxUnackedMoves` | `18`, `31`, `50`, `50`, `255`, `4` |
| `movement` | `walkFootMs`, `runFootMs`, `walkMountedMs`, `runMountedMs` | `400`, `200`, `200`, `100` |
| `time` | `gameHourRealMs`, `shardEpochOffsetMs` | `300 000` (5 мин), `0` |
| `character` | `statCap`, `minSingleStat`, `maxSingleStat`, `skillCapTenths`, `maxSingleSkillTenths`, `skillCount`, `enabledRaces` | `225`, `10`, `100`, `7000`, `1000`, `49`, `[Human (0)]` |
| `inventory` | `backpackMaxItems`, `backpackMaxWeightStones` | `125`, `400` |
| `pvp` | `criminalDurationMs`, `murdererShortTermThreshold`, `shortTermMurderDecaySec`, `longTermMurderDecaySec` | `120 000`, `5`, `28 800` (8 ч), `144 000` (40 ч) |
| `speech` | `whisperRangeTiles`, `normalRangeTiles`, `yellRangeTiles` | `1`, `15`, `18` |
| `lifecycle` | `itemDecayMs`, `unsafeLogoutDelayMs`, `safeLogoutDelayMs` | `3 600 000`, `300 000`, `0` |

## Встроенные пресеты (`RULESET_PRESETS`)

- `uor` — канонический UO:R (Felucca + Trammel).
- `uor-felucca-only` — PvP-шард с отключённым Trammel (`trammelEnabled: false`).
- `uor-dev-fast` — ускоренные таймеры для dev/CI (`nonProductionOnly: true`, запрещён в `production` с `ERR_NON_PROD_PRESET_FORBIDDEN`).

## Пример `shard-ruleset.yaml`

```yaml
preset: uor
environment: production
overrides:
  features:
    trammelEnabled: false
  network:
    aoiRadiusTiles: 22
  character:
    skillCapTenths: 7200
  lifecycle:
    itemDecayMs: 3600000
```

## Инварианты и проекция для клиента

- Все неизвестные поля отклоняются (`ERR_RULESET_UNKNOWN_KEY`), неизвестные флаги — `ERR_UNKNOWN_FEATURE_FLAG`.
- Межполевые инварианты (`multiAoi >= aoi`, порядок скоростей движения, `minStat*3 <= statCap <= maxStat*3`, `maxSkill <= skillCap`, `whisper <= normal <= yell <= aoi`, `shortTerm <= longTerm`, ≥ 1 активный игровой фасет) агрегируются в `ERR_RULESET_INVARIANT_VIOLATION`.
- `profileDigest` вычисляется синхронно через чистый FIPS 180-4 SHA-256 по канонизированному JSON (сортировка ключей по UTF-16).
- `toClientRulesetSnapshot(profile)` возвращает публичный срез с `schemaVersion` и `profileDigest`, полностью исключая секцию `internal`.
