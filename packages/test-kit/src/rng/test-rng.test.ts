import { describe, expect, it } from "vitest";
import { compareRngTraces, createRecordingRng, createTestRng } from "./test-rng.js";

describe("@uo3/test-kit — createTestRng & createRecordingRng", () => {
  it("creates reproducible RNG streams and records/compares traces step by step", () => {
    const a = createRecordingRng("trace-seed-1");
    const b = createRecordingRng("trace-seed-1");

    const run = (rng: ReturnType<typeof createRecordingRng>) => {
      rng.nextUint32();
      rng.nextFloat();
      rng.nextInt(1, 20);
      rng.chance(0.5);
      rng.rollDice(2, 6, 3);
      rng.pick(["sword", "axe", "mace"]);
      rng.pickWeighted([
        { item: "common", weight: 3 },
        { item: "rare", weight: 1 },
      ]);
      rng.shuffle([1, 2, 3, 4]);
      const child = rng.fork("loot");
      child.nextUint32();
    };

    run(a);
    run(b);

    expect(a.trace.length).toBe(9);
    expect(compareRngTraces(a.trace, b.trace)).toEqual({
      equal: true,
      firstMismatchIndex: null,
    });

    // Diverge b with one extra step
    b.nextInt(1, 10);
    const diffLen = compareRngTraces(a.trace, b.trace);
    expect(diffLen.equal).toBe(false);
    expect(diffLen.firstMismatchIndex).toBe(9);

    // Diverge at step 0 with different seed
    const c = createRecordingRng("trace-seed-2");
    c.nextUint32();
    const diffVal = compareRngTraces(a.trace, c.trace);
    expect(diffVal.equal).toBe(false);
    expect(diffVal.firstMismatchIndex).toBe(0);

    a.clearTrace();
    expect(a.trace).toHaveLength(0);

    const plain = createTestRng("trace-seed-1");
    expect(plain.toBytes().byteLength).toBe(16);
    expect(plain.snapshot()).toHaveLength(4);
  });
});
