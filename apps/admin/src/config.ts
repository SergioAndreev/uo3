import { AdminEnvSchema, loadClientConfig } from '@duskmarch/config/env/client';

export const readConfig = (env: Readonly<Record<string, unknown>>) =>
  loadClientConfig(AdminEnvSchema, env);

export type AppConfig = ReturnType<typeof readConfig>;
