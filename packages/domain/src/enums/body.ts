import { DomainError, DomainErrorCode } from "../errors/domain-error.js";

export type BodyId = number & { readonly __brand: "BodyId" };
export type BodyType = "Empty" | "Human" | "Monster" | "Animal" | "Sea" | "Equipment";

export const BODY_ID_MIN = 0x0000;
export const BODY_ID_MAX = 0xffff;

export const BODY_EMPTY = 0 as BodyId;
export const BODY_HUMAN_MALE = 400 as BodyId;
export const BODY_HUMAN_FEMALE = 401 as BodyId;
export const BODY_HUMAN_MALE_GHOST = 402 as BodyId;
export const BODY_HUMAN_FEMALE_GHOST = 403 as BodyId;
export const BODY_ELF_MALE = 605 as BodyId;
export const BODY_ELF_FEMALE = 606 as BodyId;
export const BODY_ELF_MALE_GHOST = 607 as BodyId;
export const BODY_ELF_FEMALE_GHOST = 608 as BodyId;
export const BODY_GARGOYLE_MALE = 666 as BodyId;
export const BODY_GARGOYLE_FEMALE = 667 as BodyId;
export const BODY_GARGOYLE_MALE_GHOST = 694 as BodyId;
export const BODY_GARGOYLE_FEMALE_GHOST = 695 as BodyId;
export const BODY_STAFF_ROBE = 987 as BodyId;

const HUMAN_BODIES = new Set<number>([
  BODY_HUMAN_MALE,
  BODY_HUMAN_FEMALE,
  BODY_HUMAN_MALE_GHOST,
  BODY_HUMAN_FEMALE_GHOST,
  BODY_ELF_MALE,
  BODY_ELF_FEMALE,
  BODY_ELF_MALE_GHOST,
  BODY_ELF_FEMALE_GHOST,
  BODY_GARGOYLE_MALE,
  BODY_GARGOYLE_FEMALE,
  BODY_GARGOYLE_MALE_GHOST,
  BODY_GARGOYLE_FEMALE_GHOST,
  BODY_STAFF_ROBE,
  183,
  184,
  185,
  186,
]);

const GHOST_BODIES = new Set<number>([
  BODY_HUMAN_MALE_GHOST,
  BODY_HUMAN_FEMALE_GHOST,
  BODY_ELF_MALE_GHOST,
  BODY_ELF_FEMALE_GHOST,
  BODY_GARGOYLE_MALE_GHOST,
  BODY_GARGOYLE_FEMALE_GHOST,
]);

const FEMALE_BODIES = new Set<number>([
  BODY_HUMAN_FEMALE,
  BODY_HUMAN_FEMALE_GHOST,
  BODY_ELF_FEMALE,
  BODY_ELF_FEMALE_GHOST,
  BODY_GARGOYLE_FEMALE,
  BODY_GARGOYLE_FEMALE_GHOST,
  184,
  186,
]);

const SEA_BODIES = new Set<number>([16, 77, 95, 150, 151]);

export function asBodyId(value: unknown, fieldPath?: string): BodyId {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < BODY_ID_MIN ||
    value > BODY_ID_MAX
  ) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_BODY,
      `BodyId must be an integer in [0, 65535], received ${String(value)}`,
      { ...(fieldPath !== undefined ? { fieldPath } : {}), details: { received: value } },
    );
  }
  return value as BodyId;
}

export function isEmptyBody(body: BodyId | number): boolean {
  return asBodyId(body) === BODY_EMPTY;
}

export function isHumanBody(body: BodyId | number): boolean {
  return HUMAN_BODIES.has(asBodyId(body));
}

export function isGhostBody(body: BodyId | number): boolean {
  return GHOST_BODIES.has(asBodyId(body));
}

export function isFemaleBody(body: BodyId | number): boolean {
  return FEMALE_BODIES.has(asBodyId(body));
}

export function classifyBody(body: BodyId | number): BodyType {
  const id = asBodyId(body);
  if (id === BODY_EMPTY) {
    return "Empty";
  }
  if (HUMAN_BODIES.has(id)) {
    return "Human";
  }
  if (SEA_BODIES.has(id)) {
    return "Sea";
  }
  if (id >= 200 && id < 400) {
    return "Animal";
  }
  if (id >= 1000) {
    return "Equipment";
  }
  return "Monster";
}
