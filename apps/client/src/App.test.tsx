import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfigError } from "@uo3/config/env/shared";
import { ClientApp, parseClientRuntimeConfig } from "./App.js";
import { scanBundleTextForSecrets } from "./secret-guard.js";

describe("@uo3/client unit tests", () => {
  it("loads valid VITE_* config and renders ClientApp with isomorphic package markers", () => {
    const cfg = parseClientRuntimeConfig({
      VITE_APP_ENV: "development",
      VITE_API_BASE_URL: "http://localhost:3001",
      VITE_GAME_WS_URL: "ws://localhost:2567",
      VITE_ASSET_MODE: "synthetic",
      VITE_LOG_LEVEL: "info",
    });

    const html = renderToStaticMarkup(<ClientApp config={cfg} />);
    expect(html).toContain("UO3 Client [development]");
    expect(html).toContain("@uo3/domain");
    expect(html).toContain("@uo3/rules");
    expect(html).toContain("@uo3/uo-formats");
  });

  it("throws ConfigError on invalid VITE_API_BASE_URL or VITE_GAME_WS_URL", () => {
    expect(() =>
      parseClientRuntimeConfig({
        VITE_APP_ENV: "development",
        VITE_API_BASE_URL: "ftp://invalid-url",
        VITE_GAME_WS_URL: "http://not-ws",
      }),
    ).toThrowError(ConfigError);
  });

  it("detects leaked server secrets via Vite secret-leak guard plugin", () => {
    expect(scanBundleTextForSecrets("console.log('clean browser bundle')")).toBeNull();
    expect(scanBundleTextForSecrets("const url = process.env.DATABASE_URL")).not.toBeNull();
    expect(scanBundleTextForSecrets("-----BEGIN PRIVATE KEY-----")).not.toBeNull();
  });
});
