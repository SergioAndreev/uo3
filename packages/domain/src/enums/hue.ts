import { DomainError, DomainErrorCode } from "../errors/domain-error.js";

export type Hue = number & { readonly __brand: "Hue" };

export const HUE_NONE = 0x0000 as Hue;
export const HUE_MIN = 0x0000;
export const HUE_MAX = 0xffff;
export const HUE_INDEX_MASK = 0x3fff;
export const HUE_TRANSLUCENT_BIT = 0x4000;
export const HUE_PARTIAL_BIT = 0x8000;

export const SKIN_HUE_RANGE = Object.freeze([1002, 1058] as const);
export const HAIR_HUE_RANGE = Object.freeze([1102, 1149] as const);

export interface DecodedHue {
  readonly index: number;
  readonly partialHue: boolean;
  readonly translucent: boolean;
}

export interface EncodeHueInput {
  readonly index: number;
  readonly partialHue?: boolean;
  readonly translucent?: boolean;
}

export function asHue(value: unknown, fieldPath?: string): Hue {
  if (typeof value !== "number" || !Number.isInteger(value) || value < HUE_MIN || value > HUE_MAX) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_HUE,
      `Hue must be an integer in [0x0000, 0xFFFF], received ${String(value)}`,
      { ...(fieldPath !== undefined ? { fieldPath } : {}), details: { received: value } },
    );
  }
  return value as Hue;
}

export function encodeHue(input: EncodeHueInput): Hue {
  if (!Number.isInteger(input.index) || input.index < 0 || input.index > HUE_INDEX_MASK) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_HUE,
      `Hue palette index must be in [0, ${String(HUE_INDEX_MASK)}], received ${String(input.index)}`,
      { details: { index: input.index } },
    );
  }
  let encoded = input.index & HUE_INDEX_MASK;
  if (input.partialHue) {
    encoded |= HUE_PARTIAL_BIT;
  }
  if (input.translucent) {
    encoded |= HUE_TRANSLUCENT_BIT;
  }
  return encoded as Hue;
}

export function decodeHue(hue: Hue | number): DecodedHue {
  const validated = asHue(hue);
  return Object.freeze({
    index: validated & HUE_INDEX_MASK,
    partialHue: (validated & HUE_PARTIAL_BIT) !== 0,
    translucent: (validated & HUE_TRANSLUCENT_BIT) !== 0,
  });
}

export function assertSkinHue(hue: Hue | number): Hue {
  const validated = asHue(hue, "skinHue");
  const base = validated & HUE_INDEX_MASK;
  if (base < SKIN_HUE_RANGE[0] || base > SKIN_HUE_RANGE[1]) {
    throw new DomainError(
      DomainErrorCode.ERR_HUE_OUT_OF_ALLOWED_RANGE,
      `Skin hue ${String(base)} is outside allowed range [${String(SKIN_HUE_RANGE[0])}, ${String(SKIN_HUE_RANGE[1])}]`,
      { fieldPath: "skinHue", details: { hue: base, range: SKIN_HUE_RANGE } },
    );
  }
  return validated;
}

export function assertHairHue(hue: Hue | number): Hue {
  const validated = asHue(hue, "hairHue");
  const base = validated & HUE_INDEX_MASK;
  if (base < HAIR_HUE_RANGE[0] || base > HAIR_HUE_RANGE[1]) {
    throw new DomainError(
      DomainErrorCode.ERR_HUE_OUT_OF_ALLOWED_RANGE,
      `Hair hue ${String(base)} is outside allowed range [${String(HAIR_HUE_RANGE[0])}, ${String(HAIR_HUE_RANGE[1])}]`,
      { fieldPath: "hairHue", details: { hue: base, range: HAIR_HUE_RANGE } },
    );
  }
  return validated;
}

export function writeHueBE(
  hue: Hue | number,
  target: Uint8Array = new Uint8Array(2),
  offset = 0,
): Uint8Array {
  const validated = asHue(hue);
  if (!Number.isInteger(offset) || offset < 0 || offset + 2 > target.byteLength) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_HUE,
      `Buffer too short for 2-byte hue at offset ${String(offset)}`,
    );
  }
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
  view.setUint16(offset, validated, false);
  return target;
}

export function readHueBE(bytes: Uint8Array, offset = 0): Hue {
  if (!Number.isInteger(offset) || offset < 0 || offset + 2 > bytes.byteLength) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_HUE,
      `Buffer too short for 2-byte hue at offset ${String(offset)}`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint16(offset, false) as Hue;
}
