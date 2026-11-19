export const ENV_CLIENT_MODULE_ID = "@uo3/config/env/client" as const;

export { assertClientSchemaSafe, CLIENT_ENV_PREFIX, loadClientConfig } from "./loader.js";
export { AdminEnvSchema, ClientEnvSchema, type AdminEnv, type ClientEnv } from "./schemas/index.js";
