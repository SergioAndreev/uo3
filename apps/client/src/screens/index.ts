import type { ComponentType } from 'react';
import { SCREENS, type ScreenKey } from '../app/routes.js';

/** Ленивые модули экранов по ключу маршрута. */
export const SCREEN_MODULES = Object.fromEntries(
  SCREENS.map((key) => [key, () => import('./stub.js').then((m) => ({ default: m.stub(key) }))]),
) as Record<ScreenKey, () => Promise<{ default: ComponentType }>>;
