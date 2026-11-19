import { describe, expect, it } from "vitest";
import { createTestMarker, PACKAGE_ID } from "./index.js";

describe("@uo3/test-kit", () => {
  it("creates deterministic test markers linked to core packages", () => {
    expect(PACKAGE_ID).toBe("@uo3/test-kit");
    const marker = createTestMarker("smoke", 7);
    expect(marker.tag).toBe("uo3-test:smoke:7");
    expect(marker.linkedPackages).toContain("@uo3/domain");
    expect(marker.linkedPackages).toContain("@uo3/rules");
  });
});
