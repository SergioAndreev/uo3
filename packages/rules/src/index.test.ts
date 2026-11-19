import { describe, expect, it } from "vitest";
import { getRulesPackageIdentity, PACKAGE_ID } from "./index.js";

describe("@uo3/rules", () => {
  it("exports package identity wired to @uo3/domain", () => {
    expect(PACKAGE_ID).toBe("@uo3/rules");
    expect(getRulesPackageIdentity()).toEqual({
      id: "@uo3/rules",
      layer: "rules",
      domainId: "@uo3/domain",
    });
  });
});
