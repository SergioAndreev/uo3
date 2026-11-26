import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { App } from './app.js';
import { readConfig } from './config.js';

const env = { VITE_API_BASE_URL: 'http://localhost:3001', VITE_GAME_WS_URL: 'ws://localhost:2567' };

it('рисует бейдж с проверенной конфигурацией', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  act(() => createRoot(host).render(<App config={readConfig(env)} />));
  expect(host.textContent).toContain('development');
  expect(host.querySelector('[data-testid="ruleset"]')?.textContent).toMatch(
    /^Правила duskmarch v2 · [0-9a-f]{12}$/,
  );
});

it('отклоняет невалидный URL', () => {
  expect(() => readConfig({ ...env, VITE_API_BASE_URL: 'ftp://x' })).toThrow('VITE_API_BASE_URL');
});
