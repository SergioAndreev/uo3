import { describe, expect, it } from "vitest";
import { getUoFormatsPackageIdentity, PACKAGE_ID } from "./index.js";

describe("@uo3/uo-formats", () => {
  it("exports isomorphic uo-formats identity", () => {
    expect(PACKAGE_ID).toBe("@uo3/uo-formats");
    expect(getUoFormatsPackageIdentity()).toEqual({
      id: "@uo3/uo-formats",
      layer: "uo-formats",
      domainId: "@uo3/domain",
    });
  });
});
