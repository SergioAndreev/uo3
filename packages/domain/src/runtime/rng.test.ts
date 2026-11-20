import { describe, expect, it } from "vitest";
import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import {
  createSeededRng,
  decodeRngSnapshotLe,
  encodeRngSnapshotLe,
  RngSnapshotValidator,
  Xoshiro128PlusPlusRng,
} from "./rng.js";

function expectDomainError(fn: () => unknown, code: DomainErrorCode): DomainError {
  try {
    fn();
    expect.unreachable(`Expected DomainError(${code})`);
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    const domainErr = err as DomainError;
    expect(domainErr.code).toBe(code);
    return domainErr;
  }
}

// Independent reference implementation of Blackman & Vigna xoshiro128++
function referenceXoshiro128PlusPlus(
  initial: readonly [number, number, number, number],
  count: number,
): number[] {
  let s0 = initial[0] >>> 0;
  let s1 = initial[1] >>> 0;
  let s2 = initial[2] >>> 0;
  let s3 = initial[3] >>> 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const sum = (s0 + s3) >>> 0;
    const rot = ((sum << 7) | (sum >>> 25)) >>> 0;
    out.push((rot + s0) >>> 0);
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = ((s3 << 11) | (s3 >>> 21)) >>> 0;
  }
  return out;
}

// Golden test vectors for seed 1 (SplitMix64(1) -> xoshiro128++ first 16 outputs)
const GOLDEN_SEED_1_FIRST_16: readonly number[] = [
  0x7ff78de4, 0x9a170265, 0xdac127b8, 0x9859e914, 0x4d4b41b3, 0xba2afb67, 0xedc318ad, 0x8aabeca1,
  0xa7b6cf05, 0x3ddfe677, 0x5e95e82a, 0x6be78294, 0x8fddf90a, 0xda7c88e5, 0xa4ec2a82, 0x37387c83,
];

describe("domain/deterministic-runtime — Xoshiro128PlusPlusRng", () => {
  it("supports integer, bigint, and UTF-8 string seeding with non-zero state guarantee and rejects invalid seeds", () => {
    const fromZero = createSeededRng(0);
    const zeroState = fromZero.snapshot();
    expect(zeroState[0] | zeroState[1] | zeroState[2] | zeroState[3]).not.toBe(0);

    const from1 = createSeededRng(1);
    const from1Big = createSeededRng(1n);
    const from2 = createSeededRng(2);

    const seq1 = Array.from({ length: 100 }, () => from1.nextUint32());
    const seq1Big = Array.from({ length: 100 }, () => from1Big.nextUint32());
    const seq2 = Array.from({ length: 100 }, () => from2.nextUint32());

    expect(seq1).toEqual(seq1Big);
    expect(seq1[0]).not.toBe(seq2[0]);
    expect(seq1).not.toEqual(seq2);

    const strA = createSeededRng("shard-alpha-seed-2000");
    const strB = createSeededRng("shard-alpha-seed-2000");
    const outA = Array.from({ length: 1_000 }, () => strA.nextUint32());
    const outB = Array.from({ length: 1_000 }, () => strB.nextUint32());
    expect(outA).toEqual(outB);

    expectDomainError(() => createSeededRng(Number.NaN), DomainErrorCode.ERR_INVALID_RNG_SEED);
    expectDomainError(
      () => createSeededRng(Number.POSITIVE_INFINITY),
      DomainErrorCode.ERR_INVALID_RNG_SEED,
    );
    expectDomainError(() => createSeededRng(1.5), DomainErrorCode.ERR_INVALID_RNG_SEED);
    expectDomainError(() => createSeededRng(""), DomainErrorCode.ERR_INVALID_RNG_SEED);
    expectDomainError(
      () => createSeededRng(null as unknown as number),
      DomainErrorCode.ERR_INVALID_RNG_SEED,
    );
  });

  it("matches reference xoshiro128++ bitwise across 1,000 outputs and golden 16-word vector", () => {
    const rng = createSeededRng(1);
    const initial = rng.snapshot();
    const expected1000 = referenceXoshiro128PlusPlus(initial, 1_000);
    const actual1000 = Array.from({ length: 1_000 }, () => rng.nextUint32());

    expect(actual1000).toEqual(expected1000);
    expect(actual1000.slice(0, 16)).toEqual(GOLDEN_SEED_1_FIRST_16);
  });

  it("implements nextFloat, nextInt, chance, and rollDice with strict validation", () => {
    const rng = createSeededRng("combat-tests");

    for (let i = 0; i < 200; i++) {
      const f = rng.nextFloat();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }

    for (let i = 0; i < 20; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
      expect(rng.nextInt(7, 7)).toBe(7);
    }

    // Full 32-bit span
    const full = rng.nextInt(0, 0xffffffff);
    expect(full).toBeGreaterThanOrEqual(0);
    expect(full).toBeLessThanOrEqual(0xffffffff);

    // 500 rolls of 2d6+3 strictly within [5, 15]
    for (let i = 0; i < 500; i++) {
      const roll = rng.rollDice(2, 6, 3);
      expect(roll).toBeGreaterThanOrEqual(5);
      expect(roll).toBeLessThanOrEqual(15);
    }

    expectDomainError(() => rng.nextInt(10, 5), DomainErrorCode.ERR_INVALID_RANGE);
    expectDomainError(() => rng.nextInt(1.5, 5), DomainErrorCode.ERR_INVALID_RANGE);
    expectDomainError(() => rng.nextInt(0, 0x100000000), DomainErrorCode.ERR_INVALID_RANGE);
    expectDomainError(() => rng.chance(1.2), DomainErrorCode.ERR_INVALID_PROBABILITY);
    expectDomainError(() => rng.chance(-0.1), DomainErrorCode.ERR_INVALID_PROBABILITY);
    expectDomainError(() => rng.chance(Number.NaN), DomainErrorCode.ERR_INVALID_PROBABILITY);
    expectDomainError(() => rng.rollDice(0, 6), DomainErrorCode.ERR_INVALID_RANGE);
    expectDomainError(() => rng.rollDice(2, 0), DomainErrorCode.ERR_INVALID_RANGE);
    expectDomainError(() => rng.rollDice(2, 6, 1.5), DomainErrorCode.ERR_INVALID_RANGE);
  });

  it("implements pick, pickWeighted, and immutable shuffle with convergence and validation", () => {
    const rngA = createSeededRng("collections-seed");
    const rngB = createSeededRng("collections-seed");
    const source = [1, 2, 3, 4, 5];

    const shuffledA = rngA.shuffle(source);
    const shuffledB = rngB.shuffle(source);
    expect(source).toEqual([1, 2, 3, 4, 5]);
    expect(shuffledA).toEqual(shuffledB);
    expect([...shuffledA].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);

    expect(["a", "b", "c"]).toContain(rngA.pick(["a", "b", "c"]));

    // 10,000 weighted picks: [(A, 1), (B, 3)] -> B ~ 75% ± 2%
    const weightedRng1 = createSeededRng("weighted-10k");
    const weightedRng2 = createSeededRng("weighted-10k");
    const table = [
      { item: "A", weight: 1 },
      { item: "B", weight: 3 },
    ] as const;

    let countB1 = 0;
    let countB2 = 0;
    for (let i = 0; i < 10_000; i++) {
      if (weightedRng1.pickWeighted(table) === "B") countB1++;
      if (weightedRng2.pickWeighted(table) === "B") countB2++;
    }
    expect(countB1).toBe(countB2);
    const ratioB = countB1 / 10_000;
    expect(ratioB).toBeGreaterThanOrEqual(0.73);
    expect(ratioB).toBeLessThanOrEqual(0.77);

    expectDomainError(() => rngA.pick([]), DomainErrorCode.ERR_EMPTY_COLLECTION);
    expectDomainError(() => rngA.pickWeighted([]), DomainErrorCode.ERR_EMPTY_COLLECTION);
    expectDomainError(
      () => rngA.pickWeighted([{ item: "x", weight: -3 }]),
      DomainErrorCode.ERR_INVALID_WEIGHT,
    );
    expectDomainError(
      () => rngA.pickWeighted([{ item: "x", weight: 0 }]),
      DomainErrorCode.ERR_INVALID_WEIGHT,
    );
    expectDomainError(
      () => rngA.pickWeighted([{ item: "x", weight: Number.NaN }]),
      DomainErrorCode.ERR_INVALID_WEIGHT,
    );
  });

  it("forks isolated child streams without mutating parent state and supports snapshot/binary round-trip", () => {
    const root1 = createSeededRng("shard-root");
    const root2 = createSeededRng("shard-root");

    const combat1 = root1.fork("combat");
    const loot1 = root1.fork("loot");
    for (let i = 0; i < 50; i++) {
      loot1.nextUint32();
    }

    const combat2 = root2.fork("combat");
    expect(root1.snapshot()).toEqual(root2.snapshot());

    const combatSeq1 = Array.from({ length: 100 }, () => combat1.nextUint32());
    const combatSeq2 = Array.from({ length: 100 }, () => combat2.nextUint32());
    expect(combatSeq1).toEqual(combatSeq2);

    expectDomainError(() => root1.fork(""), DomainErrorCode.ERR_INVALID_RNG_SEED);

    // Snapshot & restore after 25 steps
    const rng = createSeededRng("snapshot-seed");
    for (let i = 0; i < 25; i++) {
      rng.nextUint32();
    }
    const snap = rng.snapshot();
    expect(RngSnapshotValidator.Check(snap)).toBe(true);
    const bytes = encodeRngSnapshotLe(snap);
    expect(bytes.byteLength).toBe(16);
    expect(decodeRngSnapshotLe(bytes)).toEqual(snap);

    const next10Original = Array.from({ length: 10 }, () => rng.nextUint32());
    const restoredFromTuple = Xoshiro128PlusPlusRng.fromSnapshot(snap);
    const restoredFromBytes = Xoshiro128PlusPlusRng.fromBytes(bytes);

    expect(Array.from({ length: 10 }, () => restoredFromTuple.nextUint32())).toEqual(
      next10Original,
    );
    expect(Array.from({ length: 10 }, () => restoredFromBytes.nextUint32())).toEqual(
      next10Original,
    );

    // Invalid state rejections
    expectDomainError(
      () => Xoshiro128PlusPlusRng.fromSnapshot([0, 0, 0, 0]),
      DomainErrorCode.ERR_INVALID_RNG_STATE,
    );
    expectDomainError(
      () => Xoshiro128PlusPlusRng.fromSnapshot([1, 2, 3]),
      DomainErrorCode.ERR_INVALID_RNG_STATE,
    );
    expectDomainError(
      () => Xoshiro128PlusPlusRng.fromSnapshot([1, -2, 3, 4]),
      DomainErrorCode.ERR_INVALID_RNG_STATE,
    );
    expectDomainError(
      () => decodeRngSnapshotLe(new Uint8Array(12)),
      DomainErrorCode.ERR_INVALID_RNG_STATE,
    );
    expectDomainError(
      () => decodeRngSnapshotLe(new Uint8Array(16)),
      DomainErrorCode.ERR_INVALID_RNG_STATE,
    );
  });

  it("passes chi-squared uniformity tests on nextInt([0, 2]), nextInt([1, 100]), and shuffle", () => {
    const rng = createSeededRng("chi-squared-fixed-seed");

    // [0, 2] (3 bins, df = 2, critical value at p=0.001 is 13.82)
    const bins3 = [0, 0, 0];
    const n3 = 30_000;
    for (let i = 0; i < n3; i++) {
      bins3[rng.nextInt(0, 2)]!++;
    }
    const exp3 = n3 / 3;
    const chi3 = bins3.reduce((acc, c) => acc + (c - exp3) ** 2 / exp3, 0);
    expect(chi3).toBeLessThan(13.82);

    // [1, 100] (100 bins, df = 99, critical value at p=0.001 is 148.23)
    const bins100 = new Array<number>(100).fill(0);
    const n100 = 50_000;
    for (let i = 0; i < n100; i++) {
      bins100[rng.nextInt(1, 100) - 1]!++;
    }
    const exp100 = n100 / 100;
    const chi100 = bins100.reduce((acc, c) => acc + (c - exp100) ** 2 / exp100, 0);
    expect(chi100).toBeLessThan(148.23);

    // Shuffle uniformity of 3! = 6 permutations (df = 5, critical value at p=0.001 is 20.52)
    const permCounts = new Map<string, number>();
    const nPerm = 12_000;
    for (let i = 0; i < nPerm; i++) {
      const key = rng.shuffle([1, 2, 3]).join(",");
      permCounts.set(key, (permCounts.get(key) ?? 0) + 1);
    }
    expect(permCounts.size).toBe(6);
    const expPerm = nPerm / 6;
    let chiPerm = 0;
    for (const c of permCounts.values()) {
      chiPerm += (c - expPerm) ** 2 / expPerm;
    }
    expect(chiPerm).toBeLessThan(20.52);
  });
});
