import { describe, expect, it } from "vitest";
import { ConfigError } from "../../shared/index.js";
import { assertClientSchemaSafe, loadClientConfig } from "../loader.js";
import { AdminEnvSchema, ClientEnvSchema } from "./index.js";

describe("Browser application env schemas (ClientEnvSchema & AdminEnvSchema)", () => {
  it("passes assertClientSchemaSafe for both ClientEnvSchema and AdminEnvSchema", () => {
    expect(() => assertClientSchemaSafe(ClientEnvSchema, "client")).not.toThrow();
    expect(() => assertClientSchemaSafe(AdminEnvSchema, "admin")).not.toThrow();
  });

  it("loads valid ClientEnvSchema and AdminEnvSchema and rejects invalid URLs or modes", () => {
    const client = loadClientConfig(ClientEnvSchema, {
      VITE_APP_ENV: "development",
      VITE_API_BASE_URL: "http://localhost:3001",
      VITE_GAME_WS_URL: "ws://localhost:2567",
      VITE_ASSET_MODE: "synthetic",
      VITE_LOG_LEVEL: "info",
    });
    expect(client.VITE_ASSET_MODE).toBe("synthetic");

    const admin = loadClientConfig(AdminEnvSchema, {
      VITE_APP_ENV: "production",
      VITE_API_BASE_URL: "https://api.uo3.example",
      VITE_LOG_LEVEL: "warn",
    });
    expect(admin.VITE_API_BASE_URL).toBe("https://api.uo3.example");

    expect(() =>
      loadClientConfig(ClientEnvSchema, {
        VITE_APP_ENV: "development",
        VITE_API_BASE_URL: "ws://wrong-proto",
        VITE_GAME_WS_URL: "http://wrong-proto",
        VITE_ASSET_MODE: "invalid-mode",
      }),
    ).toThrowError(ConfigError);
  });
});
