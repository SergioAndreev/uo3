import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PACKAGE_ID, PlatformBadge, UI_KIT_DOMAIN_REF } from "./index.js";

describe("@uo3/ui-kit", () => {
  it("renders PlatformBadge in jsdom environment", () => {
    const html = renderToStaticMarkup(
      <PlatformBadge appName="UO3 Client" environment="development" />,
    );
    const container = document.createElement("div");
    container.innerHTML = html;

    const badge = container.querySelector('[data-testid="uo3-platform-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("UO3 Client [development]");
    expect(badge?.getAttribute("data-protocol")).toBe("0.0.1");
    expect(PACKAGE_ID).toBe("@uo3/ui-kit");
    expect(UI_KIT_DOMAIN_REF).toBe("@uo3/domain");
  });
});
