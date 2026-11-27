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
  if (!SENSITIVE_ROUTES.some((r) => url.pathname === r || url.pathname.startsWith(`${r}/`)))
    return {};
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

/** Изъятые параметры текущей загрузки страницы (только память). */
let captured: Record<string, string> = {};

export const captureSensitive = (href: string, history: HistoryLike): void => {
  captured = takeSensitiveParams(href, history);
};

/** Однократное чтение параметра: после чтения значение забывается. */
export function consumeSensitive(key: string): string | null {
  const value = captured[key] ?? null;
  delete captured[key];
  return value;
}

export const setSensitiveForTests = (values: Record<string, string>): void => {
  captured = { ...values };
};
