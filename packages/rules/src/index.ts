import { PACKAGE_ID as DOMAIN_PACKAGE_ID, type PackageIdentity } from "@uo3/domain";

export const PACKAGE_ID = "@uo3/rules" as const;

export function getRulesPackageIdentity(): PackageIdentity & { readonly domainId: string } {
  return {
    id: PACKAGE_ID,
    layer: "rules",
    domainId: DOMAIN_PACKAGE_ID,
  };
}
