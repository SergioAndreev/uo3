export const PACKAGE_ID = "@uo3/domain" as const;
export const PACKAGE_LAYER = "domain" as const;

export interface PackageIdentity {
  readonly id: string;
  readonly layer: string;
}

export function getDomainPackageIdentity(): PackageIdentity {
  return {
    id: PACKAGE_ID,
    layer: PACKAGE_LAYER,
  };
}

export * from "./errors/index.js";
export * from "./identity/index.js";
export * from "./coordinates/index.js";
export * from "./enums/index.js";
export * from "./runtime/index.js";
