import {
  DomainError,
  DomainErrorCode,
  FACET_FELUCCA,
  FACET_ILSHENAR,
  FACET_INTERNAL,
  FACET_MALAS,
  FACET_TERMUR,
  FACET_TOKUNO,
  FACET_TRAMMEL,
  type DeepReadonly,
  type FacetId,
  type Race,
  type SkillId,
} from "@uo3/domain";
import type { RulesetProfile } from "../schema/ruleset.schema.js";

function assertNonNegativeIntStat(value: number, statName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_STAT_VALUE,
      `Stat ${statName} must be a non-negative integer, received ${String(value)}`,
      { fieldPath: statName, details: { statName, received: value } },
    );
  }
  return value;
}

export function calcBaseMaxHits(strength: number): number {
  const str = assertNonNegativeIntStat(strength, "strength");
  return 50 + Math.floor(str / 2);
}

export function calcBaseMaxStam(dexterity: number): number {
  return assertNonNegativeIntStat(dexterity, "dexterity");
}

export function calcBaseMaxMana(intelligence: number): number {
  return assertNonNegativeIntStat(intelligence, "intelligence");
}

export function calcMaxCarryWeight(strength: number): number {
  const str = assertNonNegativeIntStat(strength, "strength");
  return 40 + Math.floor((str * 7) / 2);
}

export interface StepDelayInput {
  readonly isMounted: boolean;
  readonly isRunning: boolean;
}

export function calcStepDelayMs(
  profile: DeepReadonly<Pick<RulesetProfile, "movement" | "features">>,
  input: StepDelayInput,
): number {
  const mounted = input.isMounted && profile.features.mountSpeedBonus;
  if (mounted) {
    return input.isRunning ? profile.movement.runMountedMs : profile.movement.walkMountedMs;
  }
  return input.isRunning ? profile.movement.runFootMs : profile.movement.walkFootMs;
}

export function isFacetEnabled(
  profile: DeepReadonly<Pick<RulesetProfile, "features">>,
  facetId: FacetId | number,
): boolean {
  switch (facetId) {
    case FACET_FELUCCA:
      return profile.features.feluccaEnabled;
    case FACET_TRAMMEL:
      return profile.features.trammelEnabled;
    case FACET_ILSHENAR:
      return profile.features.ilshenarEnabled;
    case FACET_MALAS:
      return profile.features.malasEnabled;
    case FACET_TOKUNO:
      return profile.features.tokunoEnabled;
    case FACET_TERMUR:
      return profile.features.terMurEnabled;
    case FACET_INTERNAL:
      return true;
    default:
      return facetId >= 200 && facetId <= 254;
  }
}

export function isRaceEnabled(
  profile: DeepReadonly<Pick<RulesetProfile, "character">>,
  race: Race | number,
): boolean {
  return profile.character.enabledRaces.includes(race);
}

export function isSkillEnabled(
  profile: DeepReadonly<Pick<RulesetProfile, "character">>,
  skillId: SkillId | number,
): boolean {
  return Number.isInteger(skillId) && skillId >= 0 && skillId < profile.character.skillCount;
}
