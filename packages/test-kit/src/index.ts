import { PACKAGE_ID as CONTENT_ID } from "@uo3/content";
import { PACKAGE_ID as DOMAIN_ID } from "@uo3/domain";
import { PACKAGE_ID as PROTOCOL_ID } from "@uo3/protocol";
import { PACKAGE_ID as RULES_ID } from "@uo3/rules";
import { PACKAGE_ID as UO_FORMATS_ID } from "@uo3/uo-formats";

export const PACKAGE_ID = "@uo3/test-kit" as const;

export interface TestMarker {
  readonly scope: string;
  readonly seed: number;
  readonly tag: string;
  readonly linkedPackages: readonly string[];
}

export function createTestMarker(scope: string, seed = 42): TestMarker {
  return {
    scope,
    seed,
    tag: `uo3-test:${scope}:${seed}`,
    linkedPackages: [DOMAIN_ID, RULES_ID, PROTOCOL_ID, UO_FORMATS_ID, CONTENT_ID],
  };
}

export * from "./clock/index.js";
export * from "./fixtures/index.js";
export * from "./rng/index.js";
