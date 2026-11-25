import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { PlatformBadge } from './platform-badge.js';

it('показывает подпись в DOM', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  act(() => createRoot(host).render(<PlatformBadge label="Duskmarch" />));
  expect(host.querySelector('[data-testid=platform-badge]')?.textContent).toBe('Duskmarch');
});
