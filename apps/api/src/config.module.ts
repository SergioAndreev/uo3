import { Module, type DynamicModule } from "@nestjs/common";
import {
  ApiEnvSchema,
  loadServerConfigOrExit,
  type ApiEnv,
  type LoadServerConfigOptions,
} from "@uo3/config/env/server";
import { redactConfig, type DeepReadonly } from "@uo3/config/env/shared";

export const API_CONFIG_TOKEN = Symbol("API_CONFIG_TOKEN");

export type ApiConfig = DeepReadonly<ApiEnv>;

export function loadApiConfig(options: LoadServerConfigOptions = {}): ApiConfig {
  return loadServerConfigOrExit(ApiEnvSchema, {
    appName: "api",
    ...options,
  });
}

export function formatApiStartupConfigLog(config: ApiConfig): string {
  const sanitized = redactConfig(ApiEnvSchema, config as Record<string, unknown>);
  return JSON.stringify({ event: "api.config.loaded", config: sanitized });
}

@Module({})
export class PlatformConfigModule {
  public static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: PlatformConfigModule,
      global: true,
      providers: [
        {
          provide: API_CONFIG_TOKEN,
          useValue: config,
        },
      ],
      exports: [API_CONFIG_TOKEN],
    };
  }
}
