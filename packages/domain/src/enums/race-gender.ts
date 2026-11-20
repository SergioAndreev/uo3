import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import {
  BODY_ELF_FEMALE,
  BODY_ELF_FEMALE_GHOST,
  BODY_ELF_MALE,
  BODY_ELF_MALE_GHOST,
  BODY_GARGOYLE_FEMALE,
  BODY_GARGOYLE_FEMALE_GHOST,
  BODY_GARGOYLE_MALE,
  BODY_GARGOYLE_MALE_GHOST,
  BODY_HUMAN_FEMALE,
  BODY_HUMAN_FEMALE_GHOST,
  BODY_HUMAN_MALE,
  BODY_HUMAN_MALE_GHOST,
  type BodyId,
} from "./body.js";

export const Race = {
  Human: 0,
  Elf: 1,
  Gargoyle: 2,
} as const;

export type Race = (typeof Race)[keyof typeof Race];

export const Gender = {
  Male: 0,
  Female: 1,
} as const;

export type Gender = (typeof Gender)[keyof typeof Gender];

export const UOR_ENABLED_RACES: readonly Race[] = Object.freeze([Race.Human]);

export function asRace(value: unknown, fieldPath?: string): Race {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2) {
    throw new DomainError(
      DomainErrorCode.ERR_RACE_DISABLED_IN_ERA,
      `Invalid race code: ${String(value)}`,
      { ...(fieldPath !== undefined ? { fieldPath } : {}), details: { received: value } },
    );
  }
  return value as Race;
}

export function asGender(value: unknown, fieldPath?: string): Gender {
  if (value !== Gender.Male && value !== Gender.Female) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_GENDER,
      `Gender must be Male (0) or Female (1), received ${String(value)}`,
      { ...(fieldPath !== undefined ? { fieldPath } : {}), details: { received: value } },
    );
  }
  return value;
}

export function assertRaceEnabled(
  race: Race | number,
  enabledRaces: readonly Race[] = UOR_ENABLED_RACES,
): Race {
  const validRace = asRace(race, "race");
  if (!enabledRaces.includes(validRace)) {
    throw new DomainError(
      DomainErrorCode.ERR_RACE_DISABLED_IN_ERA,
      `Race ${String(validRace)} is disabled in the active era profile`,
      { fieldPath: "race", details: { race: validRace, enabledRaces } },
    );
  }
  return validRace;
}

export function resolveCharacterBody(
  race: Race | number,
  gender: Gender | number,
  isGhost = false,
  enabledRaces: readonly Race[] = UOR_ENABLED_RACES,
): BodyId {
  const validRace = assertRaceEnabled(race, enabledRaces);
  const validGender = asGender(gender, "gender");

  if (validRace === Race.Human) {
    if (validGender === Gender.Male) {
      return isGhost ? BODY_HUMAN_MALE_GHOST : BODY_HUMAN_MALE;
    }
    return isGhost ? BODY_HUMAN_FEMALE_GHOST : BODY_HUMAN_FEMALE;
  }

  if (validRace === Race.Elf) {
    if (validGender === Gender.Male) {
      return isGhost ? BODY_ELF_MALE_GHOST : BODY_ELF_MALE;
    }
    return isGhost ? BODY_ELF_FEMALE_GHOST : BODY_ELF_FEMALE;
  }

  if (validGender === Gender.Male) {
    return isGhost ? BODY_GARGOYLE_MALE_GHOST : BODY_GARGOYLE_MALE;
  }
  return isGhost ? BODY_GARGOYLE_FEMALE_GHOST : BODY_GARGOYLE_FEMALE;
}
