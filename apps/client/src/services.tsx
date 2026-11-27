import { createContext, useContext, type ReactNode } from 'react';
import type { ApiClient } from './api/client.js';
import type { SessionStore } from './session/store.js';

export interface Services {
  api: ApiClient;
  store: SessionStore;
  /** Базовый адрес API (кнопки OAuth ведут на `…/oauth/:provider/start`). */
  apiBaseUrl: string;
  now?: () => number;
  /** Активный пакет ассетов (P09 4.1); без него — пакет не загружен. */
  assets?: { active(): { id: string; version: string } | null };
  /** Период опроса каталога, мс (по умолчанию 15 000). */
  pollMs?: number;
  /** Видимость вкладки (тесты подменяют). */
  visibility?: { visible(): boolean; subscribe(listener: () => void): () => void };
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
