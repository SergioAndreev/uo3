import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { App } from './app.js';
import { readConfig } from './config.js';

const env = { VITE_API_BASE_URL: 'http://localhost:3001', VITE_GAME_WS_URL: 'ws://localhost:2567' };
const ok = { ok: true, failures: [], warnings: [] } as const;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

async function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  await act(async () => createRoot(host).render(node));
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 5)));
  return host;
}

it('игрок открывает защищённый экран', async () => {
  const host = await mount(
    <App config={readConfig(env)} capabilities={ok} initialPath="/assets" session={() => 'full'} />,
  );
  expect(host.querySelector('[data-screen]')?.getAttribute('data-screen')).toBe('assets');
});

it('без WebGL2 — блокирующий экран с кодом; без OPFS — предупреждение режима памяти', async () => {
  const blocked = await mount(
    <App
      config={readConfig(env)}
      capabilities={{ ok: false, failures: ['ERR_SHELL_WEBGL2_UNAVAILABLE'], warnings: [] }}
    />,
  );
  expect(blocked.querySelector('[data-testid=incompatible]')?.textContent).toContain(
    'ERR_SHELL_WEBGL2_UNAVAILABLE',
  );
  const memory = await mount(
    <App
      config={readConfig(env)}
      capabilities={{ ok: true, failures: [], warnings: ['storage_memory_only'] }}
      initialPath="/assets"
      session={() => 'full'}
    />,
  );
  expect(memory.textContent).toContain('только до закрытия вкладки');
  const noConfig = await mount(
    <App
      config={null}
      capabilities={{ ok: false, failures: ['ERR_SHELL_CONFIG_INVALID'], warnings: [] }}
    />,
  );
  expect(noConfig.textContent).toContain('ERR_SHELL_CONFIG_INVALID');
  expect(noConfig.textContent).not.toContain('localhost');
});

it('отклоняет невалидный URL', () => {
  expect(() => readConfig({ ...env, VITE_API_BASE_URL: 'ftp://x' })).toThrow('VITE_API_BASE_URL');
});

it('офлайн — баннер; 426 — блокирующее окно новой версии', async () => {
  const { Connectivity } = await import('./session/connectivity.js');
  const { shellSignals } = await import('./session/browser.js');
  const handlers: Record<string, () => void> = {};
  const connectivity = new Connectivity({
    addEventListener: ((t: string, h: () => void) => (handlers[t] = h)) as never,
    navigator: { onLine: true },
  });
  const host = await mount(
    <App
      config={readConfig(env)}
      capabilities={ok}
      initialPath="/assets"
      session={() => 'full'}
      connectivity={connectivity}
    />,
  );
  await act(async () => handlers['offline']?.());
  expect(host.textContent).toContain('Нет подключения к сети');
  await act(async () => handlers['online']?.());
  expect(host.textContent).not.toContain('Нет подключения к сети');
  await act(async () => shellSignals.raise({ minVersion: '1.2.0' }));
  expect(host.querySelector('[role=dialog]')?.textContent).toContain('1.2.0');
});
