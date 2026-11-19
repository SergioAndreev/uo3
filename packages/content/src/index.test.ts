import { describe, expect, it } from "vitest";
import { getContentPackageIdentity, PACKAGE_ID } from "./index.js";

describe("@uo3/content", () => {
  it("exports isomorphic content package identity wired to domain and rules", () => {
    expect(PACKAGE_ID).toBe("@uo3/content");
    expect(getContentPackageIdentity()).toEqual({
      id: "@uo3/content",
      layer: "content",
      domainId: "@uo3/domain",
      rulesId: "@uo3/rules",
    });
  });
});
