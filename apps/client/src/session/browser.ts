import { ApiClient } from '../api/client.js';
import { Connectivity } from './connectivity.js';
import { SessionStore, type IssuedToken } from './store.js';

/** Глобальные сигналы оболочки: несовместимая версия клиента. */
export const shellSignals = {
  incompatible: null as Record<string, unknown> | null,
  listeners: new Set<() => void>(),
  raise(details: Record<string, unknown>) {
    this.incompatible = details;
    for (const l of this.listeners) l();
  },
};

interface AuthTokenBody {
  status?: string;
  accessToken?: string;
  expiresIn?: number;
}

export const tokenOf = (body: AuthTokenBody): IssuedToken | null =>
  body.accessToken && body.expiresIn
    ? {
        accessToken: body.accessToken,
        expiresIn: body.expiresIn,
        kind: body.status === 'staff_2fa_setup_required' ? 'staff_setup' : 'full',
      }
    : null;

/** Сессия, API и связность браузера. */
export function createBrowserServices(baseUrl: string) {
  const channel = new BroadcastChannel('dm-session');
  let api: ApiClient | null = null;
  const store = new SessionStore({
    refresh: async () => {
      try {
        const r = await (api as ApiClient).post<AuthTokenBody>('/api/v1/auth/refresh', undefined, {
          auth: false,
        });
        const token = tokenOf(r.data);
        return token ? { ok: true, token } : { ok: false, code: 'AUTH_UNAUTHENTICATED' };
      } catch (error) {
        return { ok: false, code: (error as { code?: string }).code ?? 'NETWORK' };
      }
    },
    logout: async (token) => {
      await fetch(`${baseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
    },
    channel: channel as never,
    locks: typeof navigator !== 'undefined' && navigator.locks ? (navigator.locks as never) : null,
    now: () => Date.now(),
    setTimer: (cb, ms) => setTimeout(cb, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    onSignedOut: (reason) => {
      if (!location.pathname.startsWith('/login'))
        location.assign(`/login?reason=${encodeURIComponent(reason)}`);
    },
  });
  api = new ApiClient({
    baseUrl,
    fetch: (...args) => fetch(...args),
    token: () => store.accessToken,
    refresh: () => store.refresh(),
    onIncompatible: (d) => shellSignals.raise(d),
  });
  return { store, api, connectivity: new Connectivity() };
}
