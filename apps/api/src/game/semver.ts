/** Минимальный semver: версии `x.y.z` и диапазоны из сравнений через пробел (`>=1.0.0 <2.0.0`). */
export type Version = readonly [number, number, number];

const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

export function parseVersion(text: string): Version | null {
  const m = VERSION.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const compare = (a: Version, b: Version): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Удовлетворяет ли версия диапазону; некорректный диапазон — исключение. */
export function satisfies(version: Version, range: string): boolean {
  return range
    .trim()
    .split(/\s+/)
    .every((part) => {
      const m = /^(>=|<=|>|<|=)?(.+)$/.exec(part);
      const bound = m ? parseVersion(m[2] ?? '') : null;
      if (!m || !bound) throw new Error(`некорректный диапазон версий «${range}»`);
      const c = compare(version, bound);
      switch (m[1]) {
        case '>=':
          return c >= 0;
        case '<=':
          return c <= 0;
        case '>':
          return c > 0;
        case '<':
          return c < 0;
        default:
          return c === 0;
      }
    });
}

export const isValidRange = (range: string): boolean => {
  try {
    satisfies([0, 0, 0], range);
    return true;
  } catch {
    return false;
  }
};
