import { sha256Hex, type SeededRng, type SerialAllocator } from "@uo3/domain";
import type { RulesetPresetId, ShardRulesetOverride } from "@uo3/rules";
import { FakeGameClock } from "../clock/fake-clock.js";
import { createTestRng } from "../rng/test-rng.js";
import {
  createTestRulesetProfile,
  createTestSerialAllocator,
  type TestRulesetProfile,
} from "./domain-fixtures.js";

export interface DeterministicScenarioContext {
  readonly clock: FakeGameClock;
  readonly rng: SeededRng;
  readonly ruleset: TestRulesetProfile;
  readonly allocator: SerialAllocator;
}

export interface AssertDeterministicRunOptions {
  readonly seed?: number | bigint | string;
  readonly startMs?: number;
  readonly tickMs?: number;
  readonly preset?: RulesetPresetId;
  readonly rulesetOverrides?: ShardRulesetOverride;
}

function serializeDeterministicValue(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === "bigint") {
      return `bigint:${v.toString()}`;
    }
    if (v instanceof Uint8Array) {
      return `bytes:${Array.from(v).join(",")}`;
    }
    return v;
  });
}

export interface DeterministicRunReport<T> {
  readonly result: T;
  readonly digest: string;
}

export function assertDeterministicRun<T>(
  scenarioFn: (ctx: DeterministicScenarioContext) => T,
  options: AssertDeterministicRunOptions = {},
): DeterministicRunReport<T> {
  const seed = options.seed ?? "uo3-determinism-seed";
  const startMs = options.startMs ?? 0;
  const tickMs = options.tickMs ?? 50;
  const preset = options.preset ?? "uor";

  const runOnce = (): {
    readonly result: T;
    readonly serialized: string;
    readonly digest: string;
  } => {
    const clock = new FakeGameClock({ startMs, tickMs });
    const rng = createTestRng(seed);
    const ruleset = createTestRulesetProfile(options.rulesetOverrides, preset, "test");
    const { allocator } = createTestSerialAllocator();
    const result = scenarioFn({ clock, rng, ruleset, allocator });
    const serialized = serializeDeterministicValue(result);
    return {
      result,
      serialized,
      digest: sha256Hex(serialized),
    };
  };

  const first = runOnce();
  const second = runOnce();

  if (first.digest !== second.digest || first.serialized !== second.serialized) {
    throw new Error(
      `Determinism assertion failed: two isolated runs produced different outputs (digestA=${first.digest}, digestB=${second.digest})`,
    );
  }

  return {
    result: first.result,
    digest: first.digest,
  };
}
