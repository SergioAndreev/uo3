import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router';
import { ApiClient } from '../api/client.js';
import { appRoutes } from '../app/routes.js';
import { SCREEN_MODULES } from '../screens/index.js';
import { ServicesProvider } from '../services.js';
import { SessionStore, type Channel } from '../session/store.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

export interface FakeCall {
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
}

export type Handler = (call: FakeCall) => {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

/** Поддельный API: обработчики по `METHOD /path` (без query) и журнал вызовов. */
export function fakeApi(routes: Record<string, Handler>) {
  const calls: FakeCall[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url, 'http://api.test');
    const call = {
      method: init.method ?? 'GET',
      path: u.pathname + u.search,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: new Headers(init.headers),
    };
    calls.push(call);
    const key = `${call.method} ${u.pathname}`;
    const handler =
      routes[key] ??
      Object.entries(routes).find(([k]) =>
        new RegExp(`^${k.replace(/:[a-z]+/gi, '[^/]+')}$`).test(key),
      )?.[1];
    const r = handler?.(call) ?? { status: 404, body: { error: { code: 'NOT_FOUND' } } };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json', ...r.headers },
    });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const quietChannel = (): Channel => ({
  postMessage: () => undefined,
  addEventListener: () => undefined,
  close: () => undefined,
});

/** Оболочка с настоящими маршрутами и экранами поверх поддельного API. */
export async function shell(
  path: string,
  api: ReturnType<typeof fakeApi>,
  opts: { state?: unknown } = {},
) {
  const store = new SessionStore({
    refresh: async () => ({ ok: false, code: 'AUTH_UNAUTHENTICATED' }),
    logout: async () => undefined,
    channel: quietChannel(),
    locks: null,
    now: () => Date.now(),
    setTimer: (cb, ms) => setTimeout(cb, Math.min(ms, 1_000_000)),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
  const client = new ApiClient({
    baseUrl: 'http://api.test',
    fetch: api.fetch,
    token: () => store.accessToken,
    refresh: () => store.refresh(),
  });
  const router = createMemoryRouter(
    appRoutes({ session: () => store.kind, screens: SCREEN_MODULES, layout: () => <Outlet /> }),
    {
      initialEntries: [
        opts.state
          ? {
              pathname: path.split('?')[0] ?? path,
              search: path.includes('?') ? `?${path.split('?')[1]}` : '',
              state: opts.state,
            }
          : path,
      ],
    },
  );
  const host = document.createElement('div');
  document.body.append(host);
  await act(async () =>
    createRoot(host).render(
      <ServicesProvider services={{ api: client, store, apiBaseUrl: 'http://api.test' }}>
        <RouterProvider router={router} />
      </ServicesProvider>,
    ),
  );
  for (
    let i = 0;
    i < 200 && (router.state.navigation.state !== 'idle' || !host.firstElementChild);
    i++
  )
    await settle(1);
  await settle();
  return { host, router, store, api, text: () => host.textContent ?? '' };
}

export async function settle(n = 15): Promise<void> {
  for (let i = 0; i < n; i++) await act(async () => new Promise((r) => setTimeout(r, 2)));
}

const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

export async function type(host: HTMLElement, label: string, value: string): Promise<void> {
  const l = [...host.querySelectorAll('label')].find((x) => x.textContent?.startsWith(label));
  const input = (
    l?.htmlFor ? host.querySelector(`[id="${l.htmlFor}"]`) : l?.querySelector('input')
  ) as HTMLInputElement | null;
  if (!input) throw new Error(`нет поля ${label}`);
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export async function check(host: HTMLElement, labelStart: string): Promise<void> {
  const l = [...host.querySelectorAll('label')].find((x) =>
    x.textContent?.trim().startsWith(labelStart),
  );
  await act(async () => (l?.querySelector('input') as HTMLInputElement).click());
}

export async function click(host: HTMLElement, text: string): Promise<void> {
  const b = [...host.querySelectorAll('button')].find((x) => x.textContent?.includes(text));
  if (!b) throw new Error(`нет кнопки ${text}`);
  await act(async () => b.click());
  await settle();
}

export async function submit(host: HTMLElement): Promise<void> {
  const b = host.querySelector('button[type=submit]') as HTMLButtonElement;
  await act(async () => b.click());
  await settle();
}
