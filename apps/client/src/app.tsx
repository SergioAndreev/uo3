import { applyTokens, injectBaseStyles, Notice, Panel } from '@duskmarch/ui-kit';
import { useMemo } from 'react';
import { Outlet, RouterProvider, createBrowserRouter, createMemoryRouter } from 'react-router';
import type { CapabilityReport } from './app/capabilities.js';
import { ErrorBoundary } from './app/errors.js';
import { appRoutes, type SessionKind } from './app/routes.js';
import type { AppConfig } from './config.js';
import { SCREEN_MODULES } from './screens/index.js';

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

function Layout({ warnings }: { warnings: CapabilityReport['warnings'] }) {
  return (
    <div className="dm-root">
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
  /** Тесты: маршрутизатор в памяти. */
  initialPath?: string;
}

export function App({ config, capabilities, session = () => 'guest', initialPath }: AppProps) {
  const router = useMemo(() => {
    const routes = appRoutes({
      session,
      screens: SCREEN_MODULES,
      layout: () => <Layout warnings={capabilities.warnings} />,
    });
    return initialPath
      ? createMemoryRouter(routes, { initialEntries: [initialPath] })
      : createBrowserRouter(routes);
  }, [session, capabilities, initialPath]);
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
