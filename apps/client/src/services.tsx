import { createContext, useContext, type ReactNode } from 'react';
import type { ApiClient } from './api/client.js';
import type { SessionStore } from './session/store.js';

export interface Services {
  api: ApiClient;
  store: SessionStore;
  /** Базовый адрес API (кнопки OAuth ведут на `…/oauth/:provider/start`). */
  apiBaseUrl: string;
  now?: () => number;
}

const Context = createContext<Services | null>(null);

export function ServicesProvider({
  services,
  children,
}: {
  services: Services;
  children: ReactNode;
}) {
  return <Context.Provider value={services}>{children}</Context.Provider>;
}

export function useServices(): Services {
  const s = useContext(Context);
  if (!s) throw new Error('ServicesProvider не задан');
  return s;
}
