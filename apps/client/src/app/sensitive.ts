/** Параметры адреса, которые нельзя оставлять в истории и хранилищах. */
export const SENSITIVE_PARAMS = ['token', 'code', 'state', 'onboardingToken'] as const;
export const SENSITIVE_ROUTES = [
  '/verify-email',
  '/reset-password',
  '/oauth/callback',
  '/oauth/onboarding',
] as const;

export interface HistoryLike {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

/**
 * Изъятие одноразовых токенов из адреса до любых сетевых запросов: значения возвращаются
 * в память, адрес заменяется без query-строки чувствительных параметров.
 */
export function takeSensitiveParams(href: string, history: HistoryLike): Record<string, string> {
  const url = new URL(href);
  if (!SENSITIVE_ROUTES.some((r) => url.pathname === r)) return {};
  const taken: Record<string, string> = {};
  for (const key of SENSITIVE_PARAMS) {
    const value = url.searchParams.get(key);
    if (value !== null) {
      taken[key] = value;
      url.searchParams.delete(key);
    }
  }
  if (Object.keys(taken).length > 0)
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  return taken;
}
