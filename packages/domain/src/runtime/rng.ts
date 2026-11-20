import { Type, type Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import { sha256Bytes, utf8Encode } from "./sha256.js";

export type RngSeed = number | bigint | string;

export type RngSnapshot = readonly [number, number, number, number];

export const RngSnapshotSchema = Type.Tuple([
  Type.Integer({ minimum: 0, maximum: 0xffffffff }),
  Type.Integer({ minimum: 0, maximum: 0xffffffff }),
  Type.Integer({ minimum: 0, maximum: 0xffffffff }),
  Type.Integer({ minimum: 0, maximum: 0xffffffff }),
]);

export type RngSnapshotType = Static<typeof RngSnapshotSchema>;

export const RngSnapshotValidator = TypeCompiler.Compile(RngSnapshotSchema);

export interface WeightedEntry<T> {
  readonly item: T;
  readonly weight: number;
}

export interface SeededRng {
  nextUint32(): number;
  nextFloat(): number;
  nextInt(min: number, max: number): number;
  chance(probability: number): boolean;
  rollDice(count: number, sides: number, bonus?: number): number;
  pick<T>(items: readonly T[]): T;
  pickWeighted<T>(entries: readonly WeightedEntry<T>[]): T;
  shuffle<T>(items: readonly T[]): T[];
  fork(label: string): SeededRng;
  snapshot(): RngSnapshot;
  toBytes(): Uint8Array;
}

const MASK64 = 0xffffffffffffffffn;
const SPLITMIX64_GAMMA = 0x9e3779b97f4a7c15n;
const SPLITMIX64_MUL1 = 0xbf58476d1ce4e5b9n;
const SPLITMIX64_MUL2 = 0x94d049bb133111ebn;
const NON_ZERO_FALLBACK_WORD = 0x9e3779b9;
const UINT32_RANGE = 0x100000000;

function splitMix64Next(state: bigint): { readonly value: bigint; readonly nextState: bigint } {
  const nextState = (state + SPLITMIX64_GAMMA) & MASK64;
  let z = nextState;
  z = ((z ^ (z >> 30n)) * SPLITMIX64_MUL1) & MASK64;
  z = ((z ^ (z >> 27n)) * SPLITMIX64_MUL2) & MASK64;
  z = (z ^ (z >> 31n)) & MASK64;
  return { value: z, nextState };
}

function readUint32Le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function ensureNonZeroState(s0: number, s1: number, s2: number, s3: number): RngSnapshot {
  const w0 = s0 >>> 0;
  const w1 = s1 >>> 0;
  const w2 = s2 >>> 0;
  const w3 = s3 >>> 0;
  if ((w0 | w1 | w2 | w3) === 0) {
    return [NON_ZERO_FALLBACK_WORD, 0, 0, 0];
  }
  return [w0, w1, w2, w3];
}

export function deriveSeedState(seed: RngSeed): RngSnapshot {
  if (typeof seed === "number") {
    if (!Number.isSafeInteger(seed)) {
      throw new DomainError(
        DomainErrorCode.ERR_INVALID_RNG_SEED,
        `Invalid numeric RNG seed: expected safe integer, got ${String(seed)}`,
        { fieldPath: "seed", details: { seed } },
      );
    }
    return deriveStateFromBigInt(BigInt.asUintN(64, BigInt(seed)));
  }

  if (typeof seed === "bigint") {
    return deriveStateFromBigInt(BigInt.asUintN(64, seed));
  }

  if (typeof seed === "string") {
    if (seed.length === 0) {
      throw new DomainError(
        DomainErrorCode.ERR_INVALID_RNG_SEED,
        "Invalid string RNG seed: seed must be non-empty",
        { fieldPath: "seed" },
      );
    }
    const digest = sha256Bytes(seed);
    return ensureNonZeroState(
      readUint32Le(digest, 0),
      readUint32Le(digest, 4),
      readUint32Le(digest, 8),
      readUint32Le(digest, 12),
    );
  }

  throw new DomainError(
    DomainErrorCode.ERR_INVALID_RNG_SEED,
    `Unsupported RNG seed type: ${typeof seed}`,
    { fieldPath: "seed" },
  );
}

function deriveStateFromBigInt(seed64: bigint): RngSnapshot {
  const first = splitMix64Next(seed64);
  const second = splitMix64Next(first.nextState);
  const w0 = Number(first.value & 0xffffffffn);
  const w1 = Number((first.value >> 32n) & 0xffffffffn);
  const w2 = Number(second.value & 0xffffffffn);
  const w3 = Number((second.value >> 32n) & 0xffffffffn);
  return ensureNonZeroState(w0, w1, w2, w3);
}

function rotl32(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function validateRngSnapshot(snapshot: unknown): RngSnapshot {
  if (!Array.isArray(snapshot) || snapshot.length !== 4) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_RNG_STATE,
      "Invalid RNG state: expected a 4-element uint32 tuple",
      { fieldPath: "state", details: { length: Array.isArray(snapshot) ? snapshot.length : null } },
    );
  }

  for (let i = 0; i < 4; i++) {
    const word = snapshot[i] as unknown;
    if (typeof word !== "number" || !Number.isInteger(word) || word < 0 || word > 0xffffffff) {
      throw new DomainError(
        DomainErrorCode.ERR_INVALID_RNG_STATE,
        `Invalid RNG state word at index ${i}: expected uint32, got ${String(word)}`,
        { fieldPath: `state[${i}]`, details: { index: i, value: word } },
      );
    }
  }

  const s0 = (snapshot[0] as number) >>> 0;
  const s1 = (snapshot[1] as number) >>> 0;
  const s2 = (snapshot[2] as number) >>> 0;
  const s3 = (snapshot[3] as number) >>> 0;

  if ((s0 | s1 | s2 | s3) === 0) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_RNG_STATE,
      "Invalid RNG state: all-zero state [0, 0, 0, 0] is degenerate",
      { fieldPath: "state" },
    );
  }

  return [s0, s1, s2, s3];
}

export function encodeRngSnapshotLe(snapshot: RngSnapshot): Uint8Array {
  const valid = validateRngSnapshot(snapshot);
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, valid[0], true);
  view.setUint32(4, valid[1], true);
  view.setUint32(8, valid[2], true);
  view.setUint32(12, valid[3], true);
  return bytes;
}

export function decodeRngSnapshotLe(bytes: Uint8Array): RngSnapshot {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 16) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_RNG_STATE,
      `Invalid RNG binary snapshot: expected 16 bytes, got ${bytes instanceof Uint8Array ? bytes.byteLength : typeof bytes}`,
      { fieldPath: "bytes" },
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return validateRngSnapshot([
    view.getUint32(0, true),
    view.getUint32(4, true),
    view.getUint32(8, true),
    view.getUint32(12, true),
  ]);
}

export class Xoshiro128PlusPlusRng implements SeededRng {
  private readonly state: Uint32Array;

  public constructor(seed: RngSeed) {
    const initial = deriveSeedState(seed);
    this.state = new Uint32Array(initial);
  }

  public static fromSnapshot(snapshot: readonly number[]): Xoshiro128PlusPlusRng {
    const valid = validateRngSnapshot(snapshot);
    const instance = Object.create(Xoshiro128PlusPlusRng.prototype) as Xoshiro128PlusPlusRng;
    Object.defineProperty(instance, "state", {
      value: new Uint32Array(valid),
      writable: false,
      enumerable: false,
      configurable: false,
    });
    return instance;
  }

  public static fromBytes(bytes: Uint8Array): Xoshiro128PlusPlusRng {
    return Xoshiro128PlusPlusRng.fromSnapshot(decodeRngSnapshotLe(bytes));
  }

  public nextUint32(): number {
    const s = this.state;
    const s0 = s[0]!;
    const s1 = s[1]!;
    const s2 = s[2]!;
    const s3 = s[3]!;

    const result = (rotl32((s0 + s3) >>> 0, 7) + s0) >>> 0;
    const t = (s1 << 9) >>> 0;

    let n2 = (s2 ^ s0) >>> 0;
    let n3 = (s3 ^ s1) >>> 0;
    const n1 = (s1 ^ n2) >>> 0;
    const n0 = (s0 ^ n3) >>> 0;
    n2 = (n2 ^ t) >>> 0;
    n3 = rotl32(n3, 11);

    s[0] = n0;
    s[1] = n1;
    s[2] = n2;
    s[3] = n3;

    return result;
  }

  public nextFloat(): number {
    return this.nextUint32() / UINT32_RANGE;
  }

  public nextInt(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
      throw new DomainError(
        DomainErrorCode.ERR_INVALID_RANGE,
        `Invalid integer range [${String(min)}, ${String(max)}]`,
        { fieldPath: "range", details: { min, max } },
      );
    }
    if (min === max) {
      return min;
    }

    const span = max - min + 1;
    if (span > UINT32_RANGE) {
      throw new DomainError(
        DomainErrorCode.ERR_INVALID_RANGE,
        `Range span ${span} exceeds maximum uint32 span (${UINT32_RANGE})`,
        { fieldPath: "range", details: { min, max, span } },
      );
    }

    if (span === UINT32_RANGE) {
      return min + this.nextUint32();
    }

    // Rejection sampling eliminates modulo bias completely.
    const limit = UINT32_RANGE - (UINT32_RANGE % span);
    let sample = this.nextUint32();
    while (sample >= limit) {
      sample = this.nextUint32();
    }
    return min + (sample % span);
  }

  public chance(probability: number): boolean {
    if (
      typeof probability !== "number" ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      throw new DomainError(
        DomainErrorCode.ERR_INVALID_PROBABILITY,
        `Invalid probability: expected finite number in [0, 1], got ${String(probability)}`,
        { fieldPath: "probability", details: { probability } },
      );
    }
    if (probability === 0) {
      return false;
    }
    if (probability === 1) {
      return true;
    }
    return this.nextFloat() < probability;
  }

  public rollDice(count: number, sides: number, bonus = 0): number {
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      !Number.isInteger(sides) ||
      sides < 1 ||
      !Number.isSafeInteger(bonus)
    ) {
      throw new DomainError(
        DomainErrorCode.ERR_INVALID_RANGE,
        `Invalid dice parameters: ${String(count)}d${String(sides)}+${String(bonus)}`,
        { fieldPath: "dice", details: { count, sides, bonus } },
      );
    }

    let total = bonus;
    for (let i = 0; i < count; i++) {
      total += this.nextInt(1, sides);
    }
    return total;
  }

  public pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new DomainError(
        DomainErrorCode.ERR_EMPTY_COLLECTION,
        "Cannot pick from an empty collection",
        { fieldPath: "items" },
      );
    }
    return items[this.nextInt(0, items.length - 1)]!;
  }

  public pickWeighted<T>(entries: readonly WeightedEntry<T>[]): T {
    if (entries.length === 0) {
      throw new DomainError(
        DomainErrorCode.ERR_EMPTY_COLLECTION,
        "Cannot pickWeighted from an empty collection",
        { fieldPath: "entries" },
      );
    }

    let totalWeight = 0;
    for (let i = 0; i < entries.length; i++) {
      const weight = entries[i]!.weight;
      if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
        throw new DomainError(
          DomainErrorCode.ERR_INVALID_WEIGHT,
          `Invalid weight at index ${i}: expected finite positive number, got ${String(weight)}`,
          { fieldPath: `entries[${i}].weight`, details: { index: i, weight } },
        );
      }
      totalWeight += weight;
    }

    const threshold = this.nextFloat() * totalWeight;
    let cumulative = 0;
    for (let i = 0; i < entries.length; i++) {
      cumulative += entries[i]!.weight;
      if (threshold < cumulative) {
        return entries[i]!.item;
      }
    }
    return entries[entries.length - 1]!.item;
  }

  public shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      const tmp = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = tmp;
    }
    return copy;
  }

  public fork(label: string): Xoshiro128PlusPlusRng {
    if (typeof label !== "string" || label.length === 0) {
      throw new DomainError(
        DomainErrorCode.ERR_INVALID_RNG_SEED,
        "Invalid fork label: expected non-empty string",
        { fieldPath: "label" },
      );
    }
    const stateBytes = this.toBytes();
    const labelBytes = utf8Encode(label);
    const combined = new Uint8Array(stateBytes.length + labelBytes.length);
    combined.set(stateBytes, 0);
    combined.set(labelBytes, stateBytes.length);

    const digest = sha256Bytes(combined);
    const derived = ensureNonZeroState(
      readUint32Le(digest, 0),
      readUint32Le(digest, 4),
      readUint32Le(digest, 8),
      readUint32Le(digest, 12),
    );
    return Xoshiro128PlusPlusRng.fromSnapshot(derived);
  }

  public snapshot(): RngSnapshot {
    return [this.state[0]!, this.state[1]!, this.state[2]!, this.state[3]!];
  }

  public toBytes(): Uint8Array {
    return encodeRngSnapshotLe(this.snapshot());
  }
}

export function createSeededRng(seed: RngSeed): Xoshiro128PlusPlusRng {
  return new Xoshiro128PlusPlusRng(seed);
}
