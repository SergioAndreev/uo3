import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { checkCapabilities } from './capabilities.js';
import { diagnosticReport, reportText, sanitize } from './diagnostics.js';
import { ErrorBoundary } from './errors.js';
import { SCREENS, appRoutes, type ScreenKey, type SessionKind } from './routes.js';
import { safeReturnTo } from './return-to.js';
import { takeSensitiveParams } from './sensitive.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const screens = Object.fromEntries(
  SCREENS.map((k) => [k, async () => ({ default: () => <p data-screen={k}>{k}</p> })]),
) as Record<ScreenKey, () => Promise<{ default: () => React.JSX.Element }>>;

async function render(path: string, session: SessionKind, over: Partial<typeof screens> = {}) {
  let kind = session;
  const router = createMemoryRouter(
    appRoutes({ session: () => kind, screens: { ...screens, ...over }, layout: () => <Outlet /> }),
    { initialEntries: [path] },
  );
  const host = document.createElement('div');
  await act(async () => createRoot(host).render(<RouterProvider router={router} />));
  for (
    let i = 0;
    i < 20 && (!router.state.initialized || router.state.navigation.state !== 'idle');
    i++
  ) {
    await act(async () => new Promise((r) => setTimeout(r, 5)));
  }
  await act(async () => new Promise((r) => setTimeout(r, 5)));
  return {
    host,
    router,
    screen: () => host.querySelector('[data-screen]')?.getAttribute('data-screen'),
    setSession: (k: SessionKind) => (kind = k),
  };
}

describe('client/app-shell: маршруты и охранники', () => {
  it('корень: гость — на вход, игрок — к шардам, сотрудник без второго фактора — на настройку', async () => {
    expect((await render('/', 'guest')).router.state.location.pathname).toBe('/login');
    expect((await render('/', 'full')).router.state.location.pathname).toBe('/shards');
    expect((await render('/', 'staff_setup')).router.state.location.pathname).toBe('/2fa-setup');
  });

  it('гость на защищённом маршруте → вход с returnTo; история назад', async () => {
    const r = await render('/shards/ember/characters', 'guest');
    expect(r.router.state.location.pathname).toBe('/login');
    expect(r.router.state.location.search).toBe('?returnTo=%2Fshards%2Fember%2Fcharacters');
    const a = await render('/shards', 'full');
    await act(() => a.router.navigate('/shards/ember/characters'));
    expect(a.screen()).toBe('characters');
    await act(() => a.router.navigate(-1));
    expect(a.router.state.location.pathname).toBe('/shards');
    expect(a.screen()).toBe('shards');
  });

  it('вход уже выполнен: /login уводит на безопасный returnTo или к шардам', async () => {
    expect(
      (await render('/login?returnTo=%2Fsettings', 'full')).router.state.location.pathname,
    ).toBe('/settings');
    expect(
      (await render('/login?returnTo=https%3A%2F%2Fevil.example', 'full')).router.state.location
        .pathname,
    ).toBe('/shards');
  });

  it('сотрудник без второго фактора видит только /2fa-setup', async () => {
    for (const path of ['/shards', '/settings', '/login']) {
      expect((await render(path, 'staff_setup')).router.state.location.pathname).toBe('/2fa-setup');
    }
    expect((await render('/2fa-setup', 'staff_setup')).screen()).toBe('twoFactorSetup');
    expect((await render('/2fa-setup', 'full')).router.state.location.pathname).toBe('/shards');
  });

  it('неизвестный путь — 404 с возвратом; сбой загрузки чанка — экран восстановления', async () => {
    const g = await render('/non-existent/route', 'guest');
    expect(g.host.querySelector('[data-testid=not-found] a')?.getAttribute('href')).toBe('/login');
    expect(
      (await render('/x', 'full')).host
        .querySelector('[data-testid=not-found] a')
        ?.getAttribute('href'),
    ).toBe('/shards');
    const broken = await render('/settings', 'full', {
      settings: () => Promise.reject(new Error('Failed to fetch dynamically imported module')),
    });
    expect(broken.host.querySelector('[data-testid=route-error]')?.textContent).toContain(
      'ERR_SHELL_CHUNK_LOAD_FAILED',
    );
  });
});

describe('client/app-shell: безопасность и диагностика', () => {
  it('returnTo: только внутренние пути', () => {
    expect(safeReturnTo('%2Fshards%2Fember%2Fcharacters')).toBe('/shards/ember/characters');
    for (const bad of [
      'https://evil.example/phish',
      '//evil.example',
      'javascript:alert(1)',
      '/\\evil.example',
      '%2F%2Fevil',
      '/javascript:x',
      '%E0%A4%A',
    ])
      expect(safeReturnTo(bad)).toBeNull();
    expect(safeReturnTo(null)).toBeNull();
  });

  it('одноразовые токены изымаются из адреса до запросов', () => {
    const calls: string[] = [];
    const history = {
      replaceState: (_d: unknown, _u: string, url?: string | URL | null) =>
        void calls.push(String(url)),
    };
    expect(
      takeSensitiveParams(
        'https://play.example/reset-password?token=secret-one-time-token',
        history,
      ),
    ).toEqual({ token: 'secret-one-time-token' });
    expect(calls).toEqual(['/reset-password']);
    expect(
      takeSensitiveParams(
        'https://play.example/oauth/callback?code=abc&state=xyz&lang=ru',
        history,
      ),
    ).toEqual({ code: 'abc', state: 'xyz' });
    expect(calls.at(-1)).toBe('/oauth/callback?lang=ru');
    expect(takeSensitiveParams('https://play.example/shards?token=x', history)).toEqual({});
    expect(takeSensitiveParams('https://play.example/verify-email', history)).toEqual({});
    expect(calls).toHaveLength(2);
  });

  it('возможности браузера: WebGL2, Workers, конфигурация блокируют; нет OPFS — предупреждение', () => {
    const ok = { webgl2: () => true, workers: () => true, opfs: () => true, config: () => true };
    expect(checkCapabilities(ok)).toEqual({ ok: true, failures: [], warnings: [] });
    expect(checkCapabilities({ ...ok, webgl2: () => false })).toMatchObject({
      ok: false,
      failures: ['ERR_SHELL_WEBGL2_UNAVAILABLE'],
    });
    expect(checkCapabilities({ ...ok, opfs: () => false })).toEqual({
      ok: true,
      failures: [],
      warnings: ['storage_memory_only'],
    });
    expect(
      checkCapabilities({ ...ok, config: () => false, workers: () => false }).failures,
    ).toEqual(['ERR_SHELL_CONFIG_INVALID', 'ERR_SHELL_WORKERS_UNAVAILABLE']);
  });

  it('диагностика: токен, email и путь ОС заменены', () => {
    // Похожая на JWT строка собирается во время выполнения: это не секрет.
    const fakeJwt = ['eyJhbGciOiJFZERTQSJ9', 'eyJzdWIiOiIxMjM0NTYifQ', 'c2lnbmF0dXJlLXRleHQ'].join(
      '.',
    );
    const msg = `сбой: Authorization: Bearer ${fakeJwt} ясна@example.com C:\\Users\\Alice\\Documents\\duskmarch-backup.json /home/alice/x ?token=abc`;
    const text = sanitize(msg);
    expect(text).not.toMatch(/eyJ|example\.com|Alice|alice|abc/);
    expect(text).toContain('[REDACTED]');
    const r = diagnosticReport(new TypeError(msg), {
      route: '/settings?token=1',
      clientVersion: '0.9.0',
      correlationId: 'c-1',
      now: new Date(0),
    });
    expect(r).toMatchObject({ route: '/settings', errorType: 'TypeError', correlationId: 'c-1' });
    expect(reportText(r)).toContain('correlationId: c-1');
  });

  it('предохранитель экрана: панель восстановления, навигация живёт', async () => {
    const Boom = () => {
      throw new Error('рендер упал: Bearer abc.def.ghi');
    };
    const host = document.createElement('div');
    const reports: unknown[] = [];
    const errors = console.error;
    console.error = () => undefined;
    await act(async () =>
      createRoot(host).render(
        <>
          <nav data-testid="nav">шапка</nav>
          <ErrorBoundary
            level="screen"
            route={() => '/settings'}
            clientVersion="0.9.0"
            onReport={(r) => reports.push(r)}
          >
            <Boom />
          </ErrorBoundary>
        </>,
      ),
    );
    console.error = errors;
    expect(host.querySelector('[data-testid=nav]')?.textContent).toBe('шапка');
    expect(host.querySelector('[data-boundary=screen]')?.textContent).toContain('Код инцидента');
    expect(JSON.stringify(reports)).not.toContain('abc.def');
  });
});
