import { PACKAGE_ID as DOMAIN_PACKAGE_ID, type PackageIdentity } from "@uo3/domain";

export const PACKAGE_ID = "@uo3/uo-formats" as const;

export function getUoFormatsPackageIdentity(): PackageIdentity & { readonly domainId: string } {
  return {
    id: PACKAGE_ID,
    layer: "uo-formats",
    domainId: DOMAIN_PACKAGE_ID,
  };
}
