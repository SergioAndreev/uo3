import { describe, expect, it } from "vitest";
import { getDbPackageIdentity, PACKAGE_ID } from "./index.js";

describe("@uo3/db", () => {
  it("exports server db package identity", () => {
    expect(PACKAGE_ID).toBe("@uo3/db");
    expect(getDbPackageIdentity()).toEqual({
      id: "@uo3/db",
      domainId: "@uo3/domain",
      configId: "@uo3/config/env/server",
    });
  });
});
