export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): DeepReadonly<T> {
  if (value === null || typeof value !== "object") {
    return value as DeepReadonly<T>;
  }

  const obj = value as object;
  if (seen.has(obj)) {
    return value as DeepReadonly<T>;
  }
  seen.add(obj);

  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item, seen);
    }
  } else {
    for (const key of Reflect.ownKeys(obj)) {
      const prop = (obj as Record<PropertyKey, unknown>)[key];
      deepFreeze(prop, seen);
    }
  }

  return Object.freeze(obj) as DeepReadonly<T>;
}
