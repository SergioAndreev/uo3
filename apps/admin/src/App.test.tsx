import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfigError } from "@uo3/config/env/shared";
import { AdminApp, parseAdminRuntimeConfig } from "./App.js";

describe("@uo3/admin unit tests", () => {
  it("loads valid VITE_* admin config and renders AdminApp", () => {
    const cfg = parseAdminRuntimeConfig({
      VITE_APP_ENV: "development",
      VITE_API_BASE_URL: "http://localhost:3001",
      VITE_LOG_LEVEL: "info",
    });
    const html = renderToStaticMarkup(<AdminApp config={cfg} />);
    expect(html).toContain("UO3 Admin [development]");
    expect(html).toContain("@uo3/domain");
  });

  it("rejects invalid VITE_API_BASE_URL", () => {
    expect(() =>
      parseAdminRuntimeConfig({
        VITE_APP_ENV: "development",
        VITE_API_BASE_URL: "not-a-url",
      }),
    ).toThrowError(ConfigError);
  });
});
