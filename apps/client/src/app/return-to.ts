/** Только внутренний относительный путь того же origin: `/x`, но не `//x`, не `/\x`, не схема. */
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  if ([...value].some((ch) => ch.charCodeAt(0) < 0x20) || /^\/+[a-z][a-z0-9+.-]*:/i.test(value))
    return null;
  return value;
}

export const DEFAULT_AUTHED = '/shards';
export const DEFAULT_GUEST = '/login';
