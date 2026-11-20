import { PACKAGE_ID as DOMAIN_PACKAGE_ID, type PackageIdentity } from "@uo3/domain";

export const PACKAGE_ID = "@uo3/rules" as const;

export function getRulesPackageIdentity(): PackageIdentity & { readonly domainId: string } {
  return {
    id: PACKAGE_ID,
    layer: "rules",
    domainId: DOMAIN_PACKAGE_ID,
  };
}

export * from "./digest/index.js";
export * from "./formulas/index.js";
export * from "./profiles/index.js";
export * from "./projection/index.js";
export * from "./resolver/index.js";
export * from "./schema/index.js";
