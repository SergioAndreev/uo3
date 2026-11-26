import { DomainError } from '../errors/index.js';

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

/** Байты UTF-8 строки без зависимости от TextEncoder. */
export function utf8(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
    }
  }
  return bytes;
}

/** FNV-1a 32 по байтам UTF-8. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of utf8(text)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash;
}

/** Четыре слова состояния из 32-битного сида. */
export function splitmix32(seed: number): [number, number, number, number] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  return [next(), next(), next(), next()];
}

export type RngState = readonly [number, number, number, number];
const DICE = /^([1-9]\d{0,2})d([1-9]\d{0,3})([+-]\d{1,6})?$/;
const TWO_32 = 0x1_0000_0000;

/** `xoshiro128++`: одинаковая последовательность в браузере и Node.js. */
export class SeededRng {
  private s: [number, number, number, number];

  constructor(seed: number | string | RngState) {
    if (Array.isArray(seed))
      this.s = seed.map((x: number) => x >>> 0) as [number, number, number, number];
    else this.s = splitmix32(typeof seed === 'string' ? fnv1a(seed) : (seed as number));
    if (this.s.every((x) => x === 0)) this.s[0] = 1;
  }

  /** Следующее 32-битное беззнаковое число. */
  next(): number {
    const s = this.s;
    const result = (rotl((s[0] + s[3]) >>> 0, 7) + s[0]) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] = (s[2] ^ s[0]) >>> 0;
    s[3] = (s[3] ^ s[1]) >>> 0;
    s[1] = (s[1] ^ s[2]) >>> 0;
    s[0] = (s[0] ^ s[3]) >>> 0;
    s[2] = (s[2] ^ t) >>> 0;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** Число в `[0, 1)`. */
  float(): number {
    return this.next() / TWO_32;
  }

  /** Целое в `[min, max]` без смещения по модулю (метод отбраковки). */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min || max - min >= TWO_32) {
      throw new RangeError(`int(${min}, ${max}): некорректный диапазон`);
    }
    const range = max - min + 1;
    const limit = TWO_32 - (TWO_32 % range);
    let value = this.next();
    while (value >= limit) value = this.next();
    return min + (value % range);
  }

  chance(numerator: number, denominator: number): boolean {
    return this.int(1, denominator) <= numerator;
  }

  /** Бросок по записи `NdM+K`. */
  roll(notation: string): number {
    const match = DICE.exec(notation);
    const count = Number(match?.[1]);
    const sides = Number(match?.[2]);
    if (!match || count > 100 || sides < 2 || sides > 1000) {
      throw new DomainError(
        'ERR_INVALID_DICE',
        `«${notation}»: ожидается NdM+K, N ≤ 100, 2 ≤ M ≤ 1000`,
      );
    }
    let total = Number(match[3] ?? 0);
    for (let i = 0; i < count; i++) total += this.int(1, sides);
    return total;
  }

  /** Выбор по целым неотрицательным весам. */
  weighted<T>(items: readonly { value: T; weight: number }[]): T {
    const total = items.reduce((sum, { weight }) => {
      if (!Number.isInteger(weight) || weight < 0)
        throw new RangeError(`вес ${weight} не целый ≥ 0`);
      return sum + weight;
    }, 0);
    if (total === 0) throw new RangeError('сумма весов равна 0');
    let ticket = this.int(0, total - 1);
    for (const { value, weight } of items) {
      if (ticket < weight) return value;
      ticket -= weight;
    }
    throw new RangeError('недостижимо');
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('пустой список');
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Перемешивание Фишера — Йетса на месте. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [items[i], items[j]] = [items[j] as T, items[i] as T];
    }
    return items;
  }

  /** Независимый поток по метке; состояние родителя не меняется. */
  fork(label: string): SeededRng {
    const mix =
      (this.s[0] ^
        rotl(this.s[1], 8) ^
        rotl(this.s[2], 16) ^
        rotl(this.s[3], 24) ^
        fnv1a(label)) >>>
      0;
    return new SeededRng(mix);
  }

  snapshot(): RngState {
    return Object.freeze([...this.s]) as unknown as RngState;
  }

  static restore(state: RngState): SeededRng {
    return new SeededRng(state);
  }
}
