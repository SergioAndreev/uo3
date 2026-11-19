import { describe, expect, it } from "vitest";
import { getProtocolPackageIdentity, PACKAGE_ID, PROTOCOL_VERSION } from "./index.js";

describe("@uo3/protocol", () => {
  it("exports isomorphic protocol package identity", () => {
    expect(PACKAGE_ID).toBe("@uo3/protocol");
    expect(PROTOCOL_VERSION).toBe("0.0.1");
    expect(getProtocolPackageIdentity()).toEqual({
      id: "@uo3/protocol",
      layer: "protocol",
      domainId: "@uo3/domain",
      protocolVersion: "0.0.1",
    });
  });
});
