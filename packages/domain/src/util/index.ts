export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** Рекурсивно замораживает объект и возвращает его же; циклы допустимы. */
export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): DeepReadonly<T> {
  if (typeof value === 'object' && value !== null && !seen.has(value)) {
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key], seen);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/** JSON с ключами по возрастанию и без пробелов; одинаковые данные — одинаковая строка. */
export function canonicalJson(value: unknown): string {
  const stack = new Set<object>();
  const write = (node: unknown, path: string): string => {
    if (node === null || typeof node === 'boolean' || typeof node === 'string') {
      return JSON.stringify(node);
    }
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) throw new TypeError(`${path}: число ${node} не сериализуется`);
      return JSON.stringify(node);
    }
    if (typeof node !== 'object')
      throw new TypeError(`${path}: тип ${typeof node} не сериализуется`);
    if (stack.has(node)) throw new TypeError(`${path}: циклическая ссылка`);
    stack.add(node);
    const out = Array.isArray(node)
      ? `[${node.map((item, i) => write(item, `${path}[${i}]`)).join(',')}]`
      : `{${Object.keys(node)
          .sort()
          .map((key) => {
            const item = (node as Record<string, unknown>)[key];
            if (item === undefined) throw new TypeError(`${path}.${key}: undefined`);
            return `${JSON.stringify(key)}:${write(item, `${path}.${key}`)}`;
          })
          .join(',')}}`;
    stack.delete(node);
    return out;
  };
  return write(value, '$');
}
