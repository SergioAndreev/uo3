import { PACKAGE_ID as DOMAIN_PACKAGE_ID, type PackageIdentity } from "@uo3/domain";

export const PACKAGE_ID = "@uo3/protocol" as const;
export const PROTOCOL_VERSION = "0.0.1" as const;

export function getProtocolPackageIdentity(): PackageIdentity & {
  readonly domainId: string;
  readonly protocolVersion: string;
} {
  return {
    id: PACKAGE_ID,
    layer: "protocol",
    domainId: DOMAIN_PACKAGE_ID,
    protocolVersion: PROTOCOL_VERSION,
  };
}
