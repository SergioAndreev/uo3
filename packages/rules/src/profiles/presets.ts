import { deepFreeze, DomainError, DomainErrorCode, type DeepReadonly } from "@uo3/domain";
import type { RulesetProfile } from "../schema/ruleset.schema.js";
import { UOR_CANONICAL_PROFILE } from "./uor-canonical.js";

export type RulesetPresetId = "uor" | "uor-felucca-only" | "uor-dev-fast";

const UOR_FELUCCA_ONLY_PROFILE: DeepReadonly<RulesetProfile> = deepFreeze<RulesetProfile>({
  ...UOR_CANONICAL_PROFILE,
  meta: {
    ...UOR_CANONICAL_PROFILE.meta,
    presetId: "uor-felucca-only",
    nonProductionOnly: false,
  },
  features: {
    ...UOR_CANONICAL_PROFILE.features,
    trammelEnabled: false,
  },
  character: {
    ...UOR_CANONICAL_PROFILE.character,
    enabledRaces: [...UOR_CANONICAL_PROFILE.character.enabledRaces],
  },
});

const UOR_DEV_FAST_PROFILE: DeepReadonly<RulesetProfile> = deepFreeze<RulesetProfile>({
  ...UOR_CANONICAL_PROFILE,
  meta: {
    ...UOR_CANONICAL_PROFILE.meta,
    presetId: "uor-dev-fast",
    nonProductionOnly: true,
  },
  time: {
    ...UOR_CANONICAL_PROFILE.time,
    gameHourRealMs: 60_000,
  },
  pvp: {
    ...UOR_CANONICAL_PROFILE.pvp,
    criminalDurationMs: 15_000,
    shortTermMurderDecaySec: 300,
    longTermMurderDecaySec: 1800,
  },
  lifecycle: {
    ...UOR_CANONICAL_PROFILE.lifecycle,
    itemDecayMs: 60_000,
    unsafeLogoutDelayMs: 5_000,
  },
  character: {
    ...UOR_CANONICAL_PROFILE.character,
    enabledRaces: [...UOR_CANONICAL_PROFILE.character.enabledRaces],
  },
});

export const RULESET_PRESETS: DeepReadonly<Record<RulesetPresetId, RulesetProfile>> = deepFreeze({
  uor: UOR_CANONICAL_PROFILE as RulesetProfile,
  "uor-felucca-only": UOR_FELUCCA_ONLY_PROFILE as RulesetProfile,
  "uor-dev-fast": UOR_DEV_FAST_PROFILE as RulesetProfile,
});

export function isKnownRulesetPreset(presetId: string): presetId is RulesetPresetId {
  return Object.prototype.hasOwnProperty.call(RULESET_PRESETS, presetId);
}

export function getRulesetPreset(presetId: string): DeepReadonly<RulesetProfile> {
  if (!isKnownRulesetPreset(presetId)) {
    throw new DomainError(
      DomainErrorCode.ERR_UNKNOWN_RULESET_PRESET,
      `Unknown ruleset preset: "${presetId}"`,
      { fieldPath: "preset", details: { presetId, available: Object.keys(RULESET_PRESETS) } },
    );
  }
  return RULESET_PRESETS[presetId];
}
