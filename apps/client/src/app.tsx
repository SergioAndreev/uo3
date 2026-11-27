import { applyTokens, Button, Dialog, injectBaseStyles, Notice, Panel } from '@duskmarch/ui-kit';
import { useEffect, useMemo, useState } from 'react';
import { Outlet, RouterProvider, createBrowserRouter, createMemoryRouter } from 'react-router';
import type { CapabilityReport } from './app/capabilities.js';
import { ErrorBoundary } from './app/errors.js';
import { appRoutes, type SessionKind } from './app/routes.js';
import type { AppConfig } from './config.js';
import { SCREEN_MODULES } from './screens/index.js';
import { shellSignals } from './session/browser.js';
import type { Connectivity } from './session/connectivity.js';

export const CLIENT_VERSION = '0.9.0';

/** Блокирующий экран несовместимости браузера или конфигурации. */
export function Incompatible({ report }: { report: CapabilityReport }) {
  return (
    <Panel title="Браузер не поддерживается">
      <ul data-testid="incompatible">
        {report.failures.map((code) => (
          <li key={code}>
            {code}
            {code === 'ERR_SHELL_WEBGL2_UNAVAILABLE'
              ? ' — включите аппаратное ускорение графики'
              : ''}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function useOnline(connectivity?: Connectivity): boolean {
  const [online, setOnline] = useState(connectivity?.online ?? true);
  useEffect(() => connectivity?.subscribe(setOnline), [connectivity]);
  return online;
}

function useIncompatible(): Record<string, unknown> | null {
  const [value, setValue] = useState(shellSignals.incompatible);
  useEffect(() => {
    const l = () => setValue(shellSignals.incompatible);
    shellSignals.listeners.add(l);
    return () => void shellSignals.listeners.delete(l);
  }, []);
  return value;
}

function Layout({
  warnings,
  connectivity,
}: {
  warnings: CapabilityReport['warnings'];
  connectivity?: Connectivity;
}) {
  const online = useOnline(connectivity);
  const incompatible = useIncompatible();
  return (
    <div className="dm-root">
      {!online && <Notice tone="warning">Нет подключения к сети</Notice>}
      <Dialog
        title="Нужна новая версия клиента"
        open={incompatible !== null}
        onClose={() => undefined}
      >
        <p>
          Требуется версия протокола{' '}
          {String(incompatible?.['minVersion'] ?? incompatible?.['serverRange'] ?? 'новее')}.
        </p>
        <Button onClick={() => location.replace(`${location.pathname}?v=${Date.now()}`)}>
          Обновить клиент
        </Button>
      </Dialog>
      {warnings.includes('storage_memory_only') && (
        <Notice tone="warning">
          Хранилище браузера недоступно: пакет ассетов будет храниться только до закрытия вкладки.
        </Notice>
      )}
      <ErrorBoundary
        level="screen"
        route={() => location.pathname}
        clientVersion={CLIENT_VERSION}
        onRecover={() => location.assign('/shards')}
      >
        <Outlet />
      </ErrorBoundary>
    </div>
  );
}

export interface AppProps {
  config: AppConfig | null;
  capabilities: CapabilityReport;
  session?: () => SessionKind;
  connectivity?: Connectivity;
  /** Тесты: маршрутизатор в памяти. */
  initialPath?: string;
}

export function App({
  config,
  capabilities,
  session = () => 'guest',
  initialPath,
  connectivity,
}: AppProps) {
  const router = useMemo(() => {
    const routes = appRoutes({
      session,
      screens: SCREEN_MODULES,
      layout: () => (
        <Layout warnings={capabilities.warnings} {...(connectivity ? { connectivity } : {})} />
      ),
    });
    return initialPath
      ? createMemoryRouter(routes, { initialEntries: [initialPath] })
      : createBrowserRouter(routes);
  }, [session, capabilities, initialPath, connectivity]);
  if (!capabilities.ok || !config) return <Incompatible report={capabilities} />;
  return (
    <ErrorBoundary level="root" route={() => location.pathname} clientVersion={CLIENT_VERSION}>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}

export function bootstrap(root: HTMLElement): void {
  injectBaseStyles();
  applyTokens(root);
}
