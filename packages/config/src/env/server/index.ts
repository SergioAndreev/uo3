export const ENV_SERVER_MODULE_ID = "@uo3/config/env/server" as const;

export { loadDotEnvFiles, parseDotEnvContent } from "./dotenv.js";
export {
  loadServerConfig,
  loadServerConfigOrExit,
  type LoadServerConfigOptions,
} from "./loader.js";
export { checkProductionGuards, isDevPlaceholder } from "./prod-guards.js";
export { resolveSecretFiles, type SecretFileResolution } from "./secret-files.js";
export {
  ApiEnvSchema,
  AssetToolEnvSchema,
  BotClientEnvSchema,
  DbEnvSchema,
  GameServerEnvSchema,
  RootInfraEnvSchema,
  type ApiEnv,
  type AssetToolEnv,
  type BotClientEnv,
  type DbEnv,
  type GameServerEnv,
  type RootInfraEnv,
} from "./schemas/index.js";
