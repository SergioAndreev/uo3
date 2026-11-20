import {
  createSeededRng,
  type RngSeed,
  type RngSnapshot,
  type SeededRng,
  type WeightedEntry,
} from "@uo3/domain";

export interface RngTraceEntry {
  readonly step: number;
  readonly op: string;
  readonly args: readonly unknown[];
  readonly result: unknown;
}

export interface RngTraceDiff {
  readonly equal: boolean;
  readonly firstMismatchIndex: number | null;
  readonly entryA?: RngTraceEntry;
  readonly entryB?: RngTraceEntry;
}

export interface RecordingRng extends SeededRng {
  readonly trace: readonly RngTraceEntry[];
  clearTrace(): void;
}

export function createTestRng(seed: RngSeed = "uo3-test-seed"): SeededRng {
  return createSeededRng(seed);
}

class RecordingSeededRng implements RecordingRng {
  private readonly inner: SeededRng;
  private readonly entries: RngTraceEntry[] = [];

  public constructor(inner: SeededRng) {
    this.inner = inner;
  }

  public get trace(): readonly RngTraceEntry[] {
    return this.entries;
  }

  public clearTrace(): void {
    this.entries.length = 0;
  }

  private record<T>(op: string, args: readonly unknown[], result: T): T {
    this.entries.push({
      step: this.entries.length,
      op,
      args,
      result,
    });
    return result;
  }

  public nextUint32(): number {
    return this.record("nextUint32", [], this.inner.nextUint32());
  }

  public nextFloat(): number {
    return this.record("nextFloat", [], this.inner.nextFloat());
  }

  public nextInt(min: number, max: number): number {
    return this.record("nextInt", [min, max], this.inner.nextInt(min, max));
  }

  public chance(probability: number): boolean {
    return this.record("chance", [probability], this.inner.chance(probability));
  }

  public rollDice(count: number, sides: number, bonus = 0): number {
    return this.record("rollDice", [count, sides, bonus], this.inner.rollDice(count, sides, bonus));
  }

  public pick<T>(items: readonly T[]): T {
    return this.record("pick", [items.length], this.inner.pick(items));
  }

  public pickWeighted<T>(entries: readonly WeightedEntry<T>[]): T {
    return this.record("pickWeighted", [entries.length], this.inner.pickWeighted(entries));
  }

  public shuffle<T>(items: readonly T[]): T[] {
    return this.record("shuffle", [items.length], this.inner.shuffle(items));
  }

  public fork(label: string): RecordingRng {
    const child = new RecordingSeededRng(this.inner.fork(label));
    this.record("fork", [label], child.snapshot());
    return child;
  }

  public snapshot(): RngSnapshot {
    return this.inner.snapshot();
  }

  public toBytes(): Uint8Array {
    return this.inner.toBytes();
  }
}

export function createRecordingRng(seed: RngSeed = "uo3-test-seed"): RecordingRng {
  return new RecordingSeededRng(createSeededRng(seed));
}

export function compareRngTraces(
  traceA: readonly RngTraceEntry[],
  traceB: readonly RngTraceEntry[],
): RngTraceDiff {
  const maxLen = Math.max(traceA.length, traceB.length);
  for (let i = 0; i < maxLen; i++) {
    const a = traceA[i];
    const b = traceB[i];
    if (a === undefined || b === undefined || JSON.stringify(a) !== JSON.stringify(b)) {
      return {
        equal: false,
        firstMismatchIndex: i,
        ...(a !== undefined ? { entryA: a } : {}),
        ...(b !== undefined ? { entryB: b } : {}),
      };
    }
  }
  return { equal: true, firstMismatchIndex: null };
}
