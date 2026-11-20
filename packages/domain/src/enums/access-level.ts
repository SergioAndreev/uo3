import { DomainError, DomainErrorCode } from "../errors/domain-error.js";

export const AccessLevel = {
  Player: 0,
  Counselor: 1,
  GameMaster: 2,
  Seer: 3,
  Administrator: 4,
  Developer: 5,
  Owner: 6,
} as const;

export type AccessLevel = (typeof AccessLevel)[keyof typeof AccessLevel];

const ACCESS_LEVEL_BY_NAME: Readonly<Record<string, AccessLevel>> = Object.freeze({
  player: AccessLevel.Player,
  counselor: AccessLevel.Counselor,
  gamemaster: AccessLevel.GameMaster,
  seer: AccessLevel.Seer,
  administrator: AccessLevel.Administrator,
  developer: AccessLevel.Developer,
  owner: AccessLevel.Owner,
});

export function asAccessLevel(value: unknown, fieldPath?: string): AccessLevel {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 6) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_ACCESS_LEVEL,
      `AccessLevel must be an integer in [0, 6], received ${String(value)}`,
      { ...(fieldPath !== undefined ? { fieldPath } : {}), details: { received: value } },
    );
  }
  return value as AccessLevel;
}

export function hasAtLeastAccess(actual: AccessLevel, required: AccessLevel): boolean {
  return asAccessLevel(actual) >= asAccessLevel(required);
}

export function isStaffAccess(level: AccessLevel): boolean {
  return asAccessLevel(level) >= AccessLevel.Counselor;
}

export function canStaffTarget(actor: AccessLevel, target: AccessLevel): boolean {
  const a = asAccessLevel(actor);
  const t = asAccessLevel(target);
  if (a === AccessLevel.Owner) {
    return true;
  }
  return a > t;
}

export function parseAccessLevel(input: string, fieldPath?: string): AccessLevel {
  const normalized = input.trim().toLowerCase();
  const found = ACCESS_LEVEL_BY_NAME[normalized];
  if (found === undefined) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_ACCESS_LEVEL,
      `Unknown access level name: "${input}"`,
      { ...(fieldPath !== undefined ? { fieldPath } : {}), details: { received: input } },
    );
  }
  return found;
}
