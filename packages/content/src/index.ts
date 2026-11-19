import { PACKAGE_ID as DOMAIN_PACKAGE_ID, type PackageIdentity } from "@uo3/domain";
import { PACKAGE_ID as RULES_PACKAGE_ID } from "@uo3/rules";

export const PACKAGE_ID = "@uo3/content" as const;

export function getContentPackageIdentity(): PackageIdentity & {
  readonly domainId: string;
  readonly rulesId: string;
} {
  return {
    id: PACKAGE_ID,
    layer: "content",
    domainId: DOMAIN_PACKAGE_ID,
    rulesId: RULES_PACKAGE_ID,
  };
}
