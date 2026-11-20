import { DomainError, DomainErrorCode } from "../errors/domain-error.js";

export const SkillId = {
  Alchemy: 0,
  Anatomy: 1,
  AnimalLore: 2,
  ItemId: 3,
  ArmsLore: 4,
  Parry: 5,
  Begging: 6,
  Blacksmithy: 7,
  Fletching: 8,
  Peacemaking: 9,
  Camping: 10,
  Carpentry: 11,
  Cartography: 12,
  Cooking: 13,
  DetectHidden: 14,
  Discordance: 15,
  EvalInt: 16,
  Healing: 17,
  Fishing: 18,
  Forensics: 19,
  Herding: 20,
  Hiding: 21,
  Provocation: 22,
  Inscribe: 23,
  Lockpicking: 24,
  Magery: 25,
  MagicResist: 26,
  Tactics: 27,
  Snooping: 28,
  Musicianship: 29,
  Poisoning: 30,
  Archery: 31,
  SpiritSpeak: 32,
  Stealing: 33,
  Tailoring: 34,
  AnimalTaming: 35,
  TasteID: 36,
  Tinkering: 37,
  Tracking: 38,
  Veterinary: 39,
  Swords: 40,
  Macing: 41,
  Fencing: 42,
  Wrestling: 43,
  Lumberjacking: 44,
  Mining: 45,
  Meditation: 46,
  Stealth: 47,
  RemoveTrap: 48,
} as const;

export type SkillId = (typeof SkillId)[keyof typeof SkillId];

export const UOR_SKILL_COUNT = 49;
export const UOR_SKILL_MAX_ID = 48;

export type SkillCategory =
  "combat" | "magic" | "crafting" | "gathering" | "bard" | "rogue" | "wilderness" | "misc";

export interface SkillCatalogEntry {
  readonly id: SkillId;
  readonly key: keyof typeof SkillId;
  readonly category: SkillCategory;
}

export const UOR_SKILL_CATALOG: readonly SkillCatalogEntry[] = Object.freeze([
  Object.freeze({ id: SkillId.Alchemy, key: "Alchemy", category: "crafting" }),
  Object.freeze({ id: SkillId.Anatomy, key: "Anatomy", category: "combat" }),
  Object.freeze({ id: SkillId.AnimalLore, key: "AnimalLore", category: "wilderness" }),
  Object.freeze({ id: SkillId.ItemId, key: "ItemId", category: "misc" }),
  Object.freeze({ id: SkillId.ArmsLore, key: "ArmsLore", category: "combat" }),
  Object.freeze({ id: SkillId.Parry, key: "Parry", category: "combat" }),
  Object.freeze({ id: SkillId.Begging, key: "Begging", category: "misc" }),
  Object.freeze({ id: SkillId.Blacksmithy, key: "Blacksmithy", category: "crafting" }),
  Object.freeze({ id: SkillId.Fletching, key: "Fletching", category: "crafting" }),
  Object.freeze({ id: SkillId.Peacemaking, key: "Peacemaking", category: "bard" }),
  Object.freeze({ id: SkillId.Camping, key: "Camping", category: "wilderness" }),
  Object.freeze({ id: SkillId.Carpentry, key: "Carpentry", category: "crafting" }),
  Object.freeze({ id: SkillId.Cartography, key: "Cartography", category: "crafting" }),
  Object.freeze({ id: SkillId.Cooking, key: "Cooking", category: "crafting" }),
  Object.freeze({ id: SkillId.DetectHidden, key: "DetectHidden", category: "rogue" }),
  Object.freeze({ id: SkillId.Discordance, key: "Discordance", category: "bard" }),
  Object.freeze({ id: SkillId.EvalInt, key: "EvalInt", category: "magic" }),
  Object.freeze({ id: SkillId.Healing, key: "Healing", category: "combat" }),
  Object.freeze({ id: SkillId.Fishing, key: "Fishing", category: "gathering" }),
  Object.freeze({ id: SkillId.Forensics, key: "Forensics", category: "misc" }),
  Object.freeze({ id: SkillId.Herding, key: "Herding", category: "wilderness" }),
  Object.freeze({ id: SkillId.Hiding, key: "Hiding", category: "rogue" }),
  Object.freeze({ id: SkillId.Provocation, key: "Provocation", category: "bard" }),
  Object.freeze({ id: SkillId.Inscribe, key: "Inscribe", category: "crafting" }),
  Object.freeze({ id: SkillId.Lockpicking, key: "Lockpicking", category: "rogue" }),
  Object.freeze({ id: SkillId.Magery, key: "Magery", category: "magic" }),
  Object.freeze({ id: SkillId.MagicResist, key: "MagicResist", category: "magic" }),
  Object.freeze({ id: SkillId.Tactics, key: "Tactics", category: "combat" }),
  Object.freeze({ id: SkillId.Snooping, key: "Snooping", category: "rogue" }),
  Object.freeze({ id: SkillId.Musicianship, key: "Musicianship", category: "bard" }),
  Object.freeze({ id: SkillId.Poisoning, key: "Poisoning", category: "rogue" }),
  Object.freeze({ id: SkillId.Archery, key: "Archery", category: "combat" }),
  Object.freeze({ id: SkillId.SpiritSpeak, key: "SpiritSpeak", category: "magic" }),
  Object.freeze({ id: SkillId.Stealing, key: "Stealing", category: "rogue" }),
  Object.freeze({ id: SkillId.Tailoring, key: "Tailoring", category: "crafting" }),
  Object.freeze({ id: SkillId.AnimalTaming, key: "AnimalTaming", category: "wilderness" }),
  Object.freeze({ id: SkillId.TasteID, key: "TasteID", category: "misc" }),
  Object.freeze({ id: SkillId.Tinkering, key: "Tinkering", category: "crafting" }),
  Object.freeze({ id: SkillId.Tracking, key: "Tracking", category: "wilderness" }),
  Object.freeze({ id: SkillId.Veterinary, key: "Veterinary", category: "wilderness" }),
  Object.freeze({ id: SkillId.Swords, key: "Swords", category: "combat" }),
  Object.freeze({ id: SkillId.Macing, key: "Macing", category: "combat" }),
  Object.freeze({ id: SkillId.Fencing, key: "Fencing", category: "combat" }),
  Object.freeze({ id: SkillId.Wrestling, key: "Wrestling", category: "combat" }),
  Object.freeze({ id: SkillId.Lumberjacking, key: "Lumberjacking", category: "gathering" }),
  Object.freeze({ id: SkillId.Mining, key: "Mining", category: "gathering" }),
  Object.freeze({ id: SkillId.Meditation, key: "Meditation", category: "magic" }),
  Object.freeze({ id: SkillId.Stealth, key: "Stealth", category: "rogue" }),
  Object.freeze({ id: SkillId.RemoveTrap, key: "RemoveTrap", category: "rogue" }),
]);

export function asUorSkillId(value: unknown, fieldPath?: string): SkillId {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > UOR_SKILL_MAX_ID
  ) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_SKILL_ID,
      `UO:R skill ID must be an integer in [0, ${String(UOR_SKILL_MAX_ID)}], received ${String(value)}`,
      { ...(fieldPath !== undefined ? { fieldPath } : {}), details: { received: value } },
    );
  }
  return value as SkillId;
}

export const StatId = {
  Strength: 0,
  Dexterity: 1,
  Intelligence: 2,
} as const;

export type StatId = (typeof StatId)[keyof typeof StatId];

export function asStatId(value: unknown, fieldPath?: string): StatId {
  if (value !== StatId.Strength && value !== StatId.Dexterity && value !== StatId.Intelligence) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_STAT_ID,
      `StatId must be Strength (0), Dexterity (1), or Intelligence (2), received ${String(value)}`,
      { ...(fieldPath !== undefined ? { fieldPath } : {}), details: { received: value } },
    );
  }
  return value;
}

export const LockState = {
  Up: 0,
  Down: 1,
  Locked: 2,
} as const;

export type LockState = (typeof LockState)[keyof typeof LockState];

export function asLockState(value: unknown, fieldPath?: string): LockState {
  if (value !== LockState.Up && value !== LockState.Down && value !== LockState.Locked) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_LOCK_STATE,
      `LockState must be Up (0), Down (1), or Locked (2), received ${String(value)}`,
      { ...(fieldPath !== undefined ? { fieldPath } : {}), details: { received: value } },
    );
  }
  return value;
}

export type SkillTenths = number & { readonly __brand: "SkillTenths" };
export const SKILL_TENTHS_MIN = 0;
export const SKILL_TENTHS_MAX = 1000;

export function asSkillTenths(value: unknown, maxTenths = SKILL_TENTHS_MAX): SkillTenths {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < SKILL_TENTHS_MIN ||
    value > maxTenths
  ) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_STAT_VALUE,
      `SkillTenths must be an integer in [0, ${String(maxTenths)}], received ${String(value)}`,
      { details: { received: value, maxTenths } },
    );
  }
  return value as SkillTenths;
}

export function tenthsToDisplay(tenths: SkillTenths | number): string {
  const valid = asSkillTenths(tenths, 50_000);
  const whole = Math.floor(valid / 10);
  const frac = valid % 10;
  return `${String(whole)}.${String(frac)}`;
}

export function displayToTenths(display: string, maxTenths = SKILL_TENTHS_MAX): SkillTenths {
  const match = /^(\d+)(?:\.(\d))?$/.exec(display.trim());
  if (!match) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_STAT_VALUE,
      `Invalid skill display string (expected "NN" or "NN.D"): "${display}"`,
      { details: { received: display } },
    );
  }
  const whole = Number.parseInt(match[1]!, 10);
  const frac = match[2] !== undefined ? Number.parseInt(match[2], 10) : 0;
  return asSkillTenths(whole * 10 + frac, maxTenths);
}
