import { PACKAGE_ID as DOMAIN_PACKAGE_ID } from "@uo3/domain";

export const PACKAGE_ID = "@uo3/ui-kit" as const;
export const UI_KIT_DOMAIN_REF = DOMAIN_PACKAGE_ID;

export { PlatformBadge, type PlatformBadgeProps } from "./PlatformBadge.js";
