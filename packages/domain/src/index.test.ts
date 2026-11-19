import { describe, expect, it } from "vitest";
import { getDomainPackageIdentity, PACKAGE_ID, PACKAGE_LAYER } from "./index.js";

describe("@uo3/domain", () => {
  it("exports pure isomorphic package identity", () => {
    expect(PACKAGE_ID).toBe("@uo3/domain");
    expect(PACKAGE_LAYER).toBe("domain");
    expect(getDomainPackageIdentity()).toEqual({ id: "@uo3/domain", layer: "domain" });
  });
});
