import type { ComponentType, ReactNode } from 'react';
import { redirect, useRouteError, type LoaderFunctionArgs, type RouteObject } from 'react-router';
import { Button, Notice } from '@duskmarch/ui-kit';
import { DEFAULT_AUTHED, DEFAULT_GUEST, safeReturnTo } from './return-to.js';

/** Состояние сессии для охранников (заполняет `SessionStore`). */
export type SessionKind = 'guest' | 'full' | 'staff_setup';

export interface RouteDeps {
  session: () => SessionKind;
  /** Ленивые экраны по ключу маршрута. */
  screens: Record<ScreenKey, () => Promise<{ default: ComponentType }>>;
  layout?: ComponentType<{ children?: ReactNode }>;
}

export const SCREENS = [
  'login',
  'register',
  'verifyEmail',
  'resetPassword',
  'oauthCallback',
  'oauthOnboarding',
  'twoFactorSetup',
  'assets',
  'shards',
  'characters',
  'createCharacter',
  'play',
  'settings',
] as const;
export type ScreenKey = (typeof SCREENS)[number];

const PROTECTED = new Set<ScreenKey>([
  'assets',
  'shards',
  'characters',
  'createCharacter',
  'play',
  'settings',
]);
const GUEST_ONLY = new Set<ScreenKey>(['login', 'register']);

const PATHS: Record<ScreenKey, string> = {
  login: '/login',
  register: '/register',
  verifyEmail: '/verify-email',
  resetPassword: '/reset-password',
  oauthCallback: '/oauth/callback/:provider',
  oauthOnboarding: '/oauth/onboarding',
  twoFactorSetup: '/2fa-setup',
  assets: '/assets',
  shards: '/shards',
  characters: '/shards/:shardId/characters',
  createCharacter: '/shards/:shardId/characters/new',
  play: '/play/:shardId/:characterId',
  settings: '/settings',
};

/** Охранник: защищённые маршруты — только `full`; `staff_setup` — строго на `/2fa-setup`. */
export function guard(key: ScreenKey, session: () => SessionKind) {
  return ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    const kind = session();
    if (kind === 'staff_setup' && key !== 'twoFactorSetup') return redirect('/2fa-setup');
    if (PROTECTED.has(key) && kind === 'guest') {
      return redirect(`/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`);
    }
    if (GUEST_ONLY.has(key) && kind === 'full') {
      return redirect(safeReturnTo(url.searchParams.get('returnTo')) ?? DEFAULT_AUTHED);
    }
    if (key === 'twoFactorSetup' && kind !== 'staff_setup')
      return redirect(kind === 'full' ? DEFAULT_AUTHED : DEFAULT_GUEST);
    return null;
  };
}

/** Экран сбоя загрузки чанка или маршрута. */
export function RouteError() {
  return <ChunkError error={useRouteError()} />;
}

export function ChunkError({ error: raw }: { error: unknown }) {
  const error = raw as { message?: string } | undefined;
  const chunk =
    /dynamically imported module|Failed to fetch|Loading chunk|Importing a module script/i.test(
      error?.message ?? '',
    );
  return (
    <div data-testid="route-error">
      <Notice tone="error">
        {chunk ? 'ERR_SHELL_CHUNK_LOAD_FAILED: не удалось загрузить экран' : 'Ошибка экрана'}
      </Notice>
      <Button onClick={() => location.reload()}>Повторить загрузку</Button>
      <Button
        variant="ghost"
        onClick={() => location.replace(`${location.pathname}?v=${Date.now()}`)}
      >
        Обновить приложение
      </Button>
    </div>
  );
}

export function NotFound({ authed }: { authed: boolean }) {
  return (
    <div data-testid="not-found">
      <h1>Страница не найдена</h1>
      <a href={authed ? DEFAULT_AUTHED : DEFAULT_GUEST}>{authed ? 'К шардам' : 'Ко входу'}</a>
    </div>
  );
}

/** Дерево маршрутов оболочки. */
export function appRoutes(deps: RouteDeps): RouteObject[] {
  const Layout = deps.layout;
  const children: RouteObject[] = [
    {
      index: true,
      loader: () =>
        redirect(
          deps.session() === 'guest'
            ? DEFAULT_GUEST
            : deps.session() === 'staff_setup'
              ? '/2fa-setup'
              : DEFAULT_AUTHED,
        ),
    },
    ...SCREENS.map((key) => ({
      path: PATHS[key],
      loader: guard(key, deps.session),
      lazy: async () => {
        try {
          return { Component: (await deps.screens[key]()).default };
        } catch (error) {
          return { Component: () => <ChunkError error={error} /> };
        }
      },
      errorElement: <RouteError />,
    })),
    { path: '*', element: <NotFoundRoute session={deps.session} /> },
  ];
  return [
    {
      path: '/',
      ...(Layout ? { element: <Layout /> } : {}),
      errorElement: <RouteError />,
      children,
    },
  ];
}

function NotFoundRoute({ session }: { session: () => SessionKind }) {
  return <NotFound authed={session() === 'full'} />;
}
