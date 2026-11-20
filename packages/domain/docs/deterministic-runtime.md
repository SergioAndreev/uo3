# Детерминированная среда выполнения (`@uo3/domain/runtime`)

Модуль `@uo3/domain/runtime` обеспечивает воспроизводимое время симуляции, кросс-платформенный сидируемый ГПСЧ и каноническое игровое время UO без прямых вызовов `Date.now()`, `Math.random()` или `process.env` в доменной и игровой логике.

---

## 1. Инъецируемые игровые часы (`GameClock`, `SystemGameClock`, `FakeGameClock`)

### Контракт `GameClock`

| Поле / метод | Тип | Назначение |
| --- | --- | --- |
| `nowMs` | `number` | Монотонно неубывающее игровое время в целых мс (`>= 0`), фиксированное внутри тика. |
| `currentTick` | `number` | Номер тика `Math.floor(nowMs / tickMs)` (по умолчанию `tickMs = 50`). |
| `tickMs` | `number` | Длительность одного тика в мс (по умолчанию `50`). |
| `wallClockEpochMs` | `number` | UTC-отметка (мс от Unix epoch) исключительно для логирования и аудита. |

### Жизненный цикл `latch()` в цикле симуляции (P06)

`SystemGameClock` использует монотонный таймер (`performance.now()`, либо инъецируемый `monotonicSource`). В начале каждого шага игрового цикла сервер вызывает `clock.latch()`:

```ts
import { SystemGameClock } from "@uo3/domain/runtime";

const clock = new SystemGameClock({
  tickMs: 50,
  maxTickDeltaMs: 250,
  onDrift: (droppedMs) => {
    logger.warn({ droppedMs }, "Simulation tick drift clamped");
  },
});

function runSimulationStep(): void {
  clock.latch(); // фиксирует nowMs, currentTick и wallClockEpochMs на весь тик
  const tickNow = clock.nowMs;
  const tickNo = clock.currentTick;
  // Все подсистемы внутри этого тика увидят строго одинаковые tickNow и tickNo
  stepMovement(clock);
  stepCombat(clock);
  stepDecay(clock);
}
```

- Обратный скачок системного UTC-времени (NTP) не уменьшает `nowMs`.
- При паузе процесса длиннее `maxTickDeltaMs` (по умолчанию `250 мс` = 5 тиков) продвижение ограничивается `maxTickDeltaMs`, а отброшенная задержка `rawDelta - maxTickDeltaMs` передаётся в `onDrift(droppedMs)`.

### Использование `FakeGameClock` в Vitest

```ts
import { FakeGameClock } from "@uo3/test-kit/clock";

const clock = new FakeGameClock({ startMs: 0, tickMs: 50 });
clock.advanceTicks(4); // nowMs = 200, currentTick = 4
clock.advanceBy(30);   // nowMs = 230, currentTick = 4

const snap = clock.snapshot();
clock.advanceTo(15_000);
clock.restore(snap);   // точный возврат к 230 мс
```

Некорректные дельты (отрицательные, дробные, `NaN`, `Infinity`) отклоняются с `ERR_INVALID_TIME_DELTA`, а попытка отката `advanceTo(targetMs < nowMs)` — с `ERR_CLOCK_BACKWARD_JUMP` без изменения состояния часов.

---

## 2. Кросс-платформенный ГПСЧ (`xoshiro128++`)

Реализован в `Xoshiro128PlusPlusRng` (Blackman & Vigna, 2019) на чистой 32-битной беззнаковой арифметике (`Uint32Array(4)`, `rotl32`, ноль `BigInt` в горячем цикле).

### Сидирование (`deriveSeedState`)

- Целое `number` (safe integer) или `bigint` → 2 шага `SplitMix64` (64-битное состояние), раскладываемые в 4 uint32-слова.
- Непустая UTF-8 строка → чистый синхронный `SHA-256` (FIPS 180-4), первые 16 байт в little-endian.
- Гарантия ненулевого состояния: если все 4 слова равны `0`, устанавливается `s0 = 0x9e3779b9`.
- `NaN`, `Infinity`, дробное число или `""` → `ERR_INVALID_RNG_SEED`.

### Эталонные Golden Test-Vectors (seed = `1`, первые 16 uint32)

```text
0x7ff78de4, 0x9a170265, 0xdac127b8, 0x9859e914,
0x4d4b41b3, 0xba2afb67, 0xedc318ad, 0x8aabeca1,
0xa7b6cf05, 0x3ddfe677, 0x5e95e82a, 0x6be78294,
0x8fddf90a, 0xda7c88e5, 0xa4ec2a82, 0x37387c83
```

### Ветвление подсистем (`fork`)

Метод `rng.fork(label)` вычисляет `SHA-256(stateBytes16 || utf8(label))` и создаёт независимый экземпляр `Xoshiro128PlusPlusRng`, **не изменяя** состояние родительского генератора:

```ts
import { createSeededRng } from "@uo3/domain/runtime";

const rootRng = createSeededRng("shard-alpha-seed-2000");
const combatRng = rootRng.fork("combat");
const lootRng = rootRng.fork("loot");
// Любое число шагов в lootRng не влияет на последовательность combatRng
```

### Формат 16-байтового бинарного снапшота (LE)

| Смещение (байты) | Поле | Формат |
| --- | --- | --- |
| `0..3` | `s0` | `uint32 LE` |
| `4..7` | `s1` | `uint32 LE` |
| `8..11` | `s2` | `uint32 LE` |
| `12..15` | `s3` | `uint32 LE` |

Снапшот `[0, 0, 0, 0]` или массив/буфер неверной длины отклоняются с `ERR_INVALID_RNG_STATE`.

---

## 3. Игровое время UO, фазы суток, глобальное освещение и луны

Канон профиля `uor`:

- `1` игровой час = `300 000 мс` (`5` реальных минут)
- `1` игровая минута = `5 000 мс`
- `1` игровые сутки = `7 200 000 мс` (`120` реальных минут, `1 440` игровых минут)

### Таблица фаз суток (`computeDayPhase`)

| Фаза (`DayPhase`) | Игровые часы | Минуты суток (`minuteOfDay`) | Глобальный уровень темноты (`0..26`) |
| --- | --- | --- | --- |
| `Night` | `22:00–03:59` | `1320..1439`, `0..239` | `26` (глубокая ночь) |
| `Dawn` | `04:00–05:59` | `240..359` | Линейно `26 → 0`: `Math.round(26 * (360 - m) / 120)` (`05:00` → `13`) |
| `Day` | `06:00–19:59` | `360..1199` | `0` (полный день) |
| `Dusk` | `20:00–21:59` | `1200..1319` | Линейно `0 → 26`: `Math.round(26 * (m - 1200) / 120)` (`21:00` → `13`) |

### Циклы лун (`computeMoonPhases`, для P10 / P25)

- **Трамел (`trammelPhase`):** период `8` игровых дней, 8 фаз `0..7` → `day % 8`.
- **Фелукка (`feluccaPhase`):** период `24` игровых дня, 8 фаз `0..7` (каждая фаза длится 3 игровых дня) → `Math.floor((day % 24) / 3)`.
