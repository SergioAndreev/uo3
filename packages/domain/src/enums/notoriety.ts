import { DomainError, DomainErrorCode } from "../errors/domain-error.js";

export const Notoriety = {
  Innocent: 1,
  Ally: 2,
  CanBeAttacked: 3,
  Criminal: 4,
  Enemy: 5,
  Murderer: 6,
  Invulnerable: 7,
} as const;

export type Notoriety = (typeof Notoriety)[keyof typeof Notoriety];

export type NotorietyColorToken = "blue" | "green" | "gray" | "orange" | "red" | "yellow";

export interface NotorietyMetadata {
  readonly code: Notoriety;
  readonly name: string;
  readonly colorToken: NotorietyColorToken;
  readonly uoHue: number;
  readonly isCriminalToAttack: boolean;
  readonly canReceiveDamage: boolean;
}

export const NOTORIETY_METADATA: Readonly<Record<Notoriety, NotorietyMetadata>> = Object.freeze({
  [Notoriety.Innocent]: Object.freeze({
    code: Notoriety.Innocent,
    name: "Innocent",
    colorToken: "blue",
    uoHue: 0x0059,
    isCriminalToAttack: true,
    canReceiveDamage: true,
  }),
  [Notoriety.Ally]: Object.freeze({
    code: Notoriety.Ally,
    name: "Ally",
    colorToken: "green",
    uoHue: 0x003f,
    isCriminalToAttack: false,
    canReceiveDamage: true,
  }),
  [Notoriety.CanBeAttacked]: Object.freeze({
    code: Notoriety.CanBeAttacked,
    name: "CanBeAttacked",
    colorToken: "gray",
    uoHue: 0x03b2,
    isCriminalToAttack: false,
    canReceiveDamage: true,
  }),
  [Notoriety.Criminal]: Object.freeze({
    code: Notoriety.Criminal,
    name: "Criminal",
    colorToken: "gray",
    uoHue: 0x03b2,
    isCriminalToAttack: false,
    canReceiveDamage: true,
  }),
  [Notoriety.Enemy]: Object.freeze({
    code: Notoriety.Enemy,
    name: "Enemy",
    colorToken: "orange",
    uoHue: 0x0090,
    isCriminalToAttack: false,
    canReceiveDamage: true,
  }),
  [Notoriety.Murderer]: Object.freeze({
    code: Notoriety.Murderer,
    name: "Murderer",
    colorToken: "red",
    uoHue: 0x0022,
    isCriminalToAttack: false,
    canReceiveDamage: true,
  }),
  [Notoriety.Invulnerable]: Object.freeze({
    code: Notoriety.Invulnerable,
    name: "Invulnerable",
    colorToken: "yellow",
    uoHue: 0x0035,
    isCriminalToAttack: false,
    canReceiveDamage: false,
  }),
});

export function asNotoriety(value: unknown, fieldPath?: string): Notoriety {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 7) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_NOTORIETY,
      `Notoriety must be an integer in [1, 7], received ${String(value)}`,
      { ...(fieldPath !== undefined ? { fieldPath } : {}), details: { received: value } },
    );
  }
  return value as Notoriety;
}

export function getNotorietyMetadata(notoriety: Notoriety | number): NotorietyMetadata {
  return NOTORIETY_METADATA[asNotoriety(notoriety)];
}
