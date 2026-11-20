# `@uo3/test-kit` — Детерминированный тестовый инструментарий UO3

Пакет предназначен для unit- и интеграционных тестов фаз **P02–P36**. Предоставляет управляемые игровые часы, сидируемый и записывающий ГПСЧ, готовые доменные фикстуры и проверку детерминизма сценариев.

## Субпаты импорта

- `@uo3/test-kit` — полный реэкспорт всех инструментов.
- `@uo3/test-kit/clock` — `FakeGameClock`.
- `@uo3/test-kit/rng` — `createTestRng`, `createRecordingRng`, `compareRngTraces`.
- `@uo3/test-kit/fixtures` — `createTestSerialAllocator`, `createTestRulesetProfile`, `createSyntheticFacet`, `createTestPoint3D`, `createTestLandTileData`, `createTestItemTileData`, `assertDeterministicRun`.

## Пример 1: `FakeGameClock` и игровое время

```ts
import { computeGameTime } from "@uo3/domain";
import { FakeGameClock } from "@uo3/test-kit/clock";

export function exampleClockUsage(): number {
  const clock = new FakeGameClock({ startMs: 0, tickMs: 50 });
  clock.advanceTicks(100);
  const gameTime = computeGameTime(clock.nowMs);
  return gameTime.globalLightLevel;
}
```

## Пример 2: `createRecordingRng` и сравнение трасс

```ts
import { compareRngTraces, createRecordingRng } from "@uo3/test-kit/rng";

export function exampleRecordingRng(): boolean {
  const rngA = createRecordingRng("combat-replay-1");
  const rngB = createRecordingRng("combat-replay-1");

  rngA.rollDice(2, 6, 3);
  rngB.rollDice(2, 6, 3);

  return compareRngTraces(rngA.trace, rngB.trace).equal;
}
```

## Пример 3: Доменные фикстуры и `assertDeterministicRun`

```ts
import { Direction, stepPoint } from "@uo3/domain";
import {
  assertDeterministicRun,
  createSyntheticFacet,
  createTestPoint3D,
} from "@uo3/test-kit/fixtures";

export function exampleDeterministicScenario(): string {
  const facet = createSyntheticFacet(201);
  const report = assertDeterministicRun(
    ({ clock, rng, allocator }) => {
      clock.advanceTicks(4);
      const mobile = allocator.allocateMobile();
      const start = createTestPoint3D(10, 10, 0);
      const next = stepPoint(start, Direction.East);
      return { facet: facet.id, mobile, next, roll: rng.nextInt(1, 100), tick: clock.currentTick };
    },
    { seed: "readme-example" },
  );
  return report.digest;
}
```
