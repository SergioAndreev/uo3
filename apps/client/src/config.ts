import { ClientEnvSchema, loadClientConfig } from '@duskmarch/config/env/client';

export const readConfig = (env: Readonly<Record<string, unknown>>) =>
  loadClientConfig(ClientEnvSchema, env);

export type AppConfig = ReturnType<typeof readConfig>;
