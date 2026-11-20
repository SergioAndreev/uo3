import { DomainError, DomainErrorCode } from "../errors/domain-error.js";

export const SERIAL_NULL = 0x00000000 as Serial;
export const MOBILE_SERIAL_MIN = 0x00000001;
export const MOBILE_SERIAL_MAX = 0x3fffffff;
export const NPC_MOBILE_POOL_MIN = 0x20000000;
export const ITEM_SERIAL_MIN = 0x40000000;
export const ITEM_SERIAL_MAX = 0x7fffffff;
export const EPHEMERAL_SERIAL_MIN = 0x80000000;
export const EPHEMERAL_SERIAL_MAX = 0xfffffffe;
export const SERIAL_SENTINEL = 0xffffffff as Serial;
export const SERIAL_UINT32_MAX = 0xffffffff;

export const MOBILE_SERIAL_CAPACITY = MOBILE_SERIAL_MAX - MOBILE_SERIAL_MIN + 1; // 1_073_741_823
export const ITEM_SERIAL_CAPACITY = ITEM_SERIAL_MAX - ITEM_SERIAL_MIN + 1; // 1_073_741_824

export type Serial = number & { readonly __brand: "Serial" };
export type MobileSerial = Serial & { readonly __serialKind: "mobile" };
export type ItemSerial = Serial & { readonly __serialKind: "item" };
export type EphemeralSerial = Serial & { readonly __serialKind: "ephemeral" };
export type EntitySerial = MobileSerial | ItemSerial;

export type SerialKind = "null" | "mobile" | "item" | "ephemeral" | "sentinel";

const CANONICAL_HEX_PATTERN = /^0x[0-9a-fA-F]{8}$/;

export function isValidUint32Serial(value: unknown): value is Serial {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= SERIAL_UINT32_MAX
  );
}

export function asSerial(value: unknown, fieldPath?: string): Serial {
  if (!isValidUint32Serial(value)) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_SERIAL,
      `Invalid uint32 serial value: ${String(value)}`,
      { ...(fieldPath !== undefined ? { fieldPath } : {}), details: { received: value } },
    );
  }
  return value;
}

export function getSerialKind(value: number): SerialKind {
  const serial = asSerial(value);
  if (serial === 0) {
    return "null";
  }
  if (serial <= MOBILE_SERIAL_MAX) {
    return "mobile";
  }
  if (serial <= ITEM_SERIAL_MAX) {
    return "item";
  }
  if (serial <= EPHEMERAL_SERIAL_MAX) {
    return "ephemeral";
  }
  return "sentinel";
}

export function isNullSerial(value: unknown): value is Serial {
  return isValidUint32Serial(value) && value === 0;
}

export function isMobileSerial(value: unknown): value is MobileSerial {
  return isValidUint32Serial(value) && value >= MOBILE_SERIAL_MIN && value <= MOBILE_SERIAL_MAX;
}

export function isItemSerial(value: unknown): value is ItemSerial {
  return isValidUint32Serial(value) && value >= ITEM_SERIAL_MIN && value <= ITEM_SERIAL_MAX;
}

export function isEphemeralSerial(value: unknown): value is EphemeralSerial {
  return (
    isValidUint32Serial(value) && value >= EPHEMERAL_SERIAL_MIN && value <= EPHEMERAL_SERIAL_MAX
  );
}

export function isSentinelSerial(value: unknown): value is Serial {
  return isValidUint32Serial(value) && value === SERIAL_UINT32_MAX;
}

export function isReservedSerial(value: unknown): value is Serial {
  return isValidUint32Serial(value) && value >= EPHEMERAL_SERIAL_MIN;
}

export function isValidEntitySerial(value: unknown): value is EntitySerial {
  return isMobileSerial(value) || isItemSerial(value);
}

export function asMobileSerial(value: unknown, fieldPath?: string): MobileSerial {
  const serial = asSerial(value, fieldPath);
  if (!isMobileSerial(serial)) {
    throw new DomainError(
      DomainErrorCode.ERR_SERIAL_KIND_MISMATCH,
      `Expected mobile serial (0x00000001..0x3FFFFFFF), received ${formatSerial(serial)} (${getSerialKind(serial)})`,
      {
        ...(fieldPath !== undefined ? { fieldPath } : {}),
        details: { expectedKind: "mobile", actualKind: getSerialKind(serial), serial },
      },
    );
  }
  return serial;
}

export function asItemSerial(value: unknown, fieldPath?: string): ItemSerial {
  const serial = asSerial(value, fieldPath);
  if (!isItemSerial(serial)) {
    throw new DomainError(
      DomainErrorCode.ERR_SERIAL_KIND_MISMATCH,
      `Expected item serial (0x40000000..0x7FFFFFFF), received ${formatSerial(serial)} (${getSerialKind(serial)})`,
      {
        ...(fieldPath !== undefined ? { fieldPath } : {}),
        details: { expectedKind: "item", actualKind: getSerialKind(serial), serial },
      },
    );
  }
  return serial;
}

export function asEphemeralSerial(value: unknown, fieldPath?: string): EphemeralSerial {
  const serial = asSerial(value, fieldPath);
  if (!isEphemeralSerial(serial)) {
    throw new DomainError(
      DomainErrorCode.ERR_SERIAL_KIND_MISMATCH,
      `Expected ephemeral serial (0x80000000..0xFFFFFFFE), received ${formatSerial(serial)} (${getSerialKind(serial)})`,
      {
        ...(fieldPath !== undefined ? { fieldPath } : {}),
        details: { expectedKind: "ephemeral", actualKind: getSerialKind(serial), serial },
      },
    );
  }
  return serial;
}

export function compareSerials(a: Serial | number, b: Serial | number): -1 | 0 | 1 {
  const sa = asSerial(a);
  const sb = asSerial(b);
  if (sa < sb) {
    return -1;
  }
  if (sa > sb) {
    return 1;
  }
  return 0;
}

export function serialEquals(a: Serial | number, b: Serial | number): boolean {
  return asSerial(a) === asSerial(b);
}

export function formatSerial(serial: Serial | number): string {
  const validated = asSerial(serial);
  return `0x${validated.toString(16).toUpperCase().padStart(8, "0")}`;
}

export function parseSerial(input: string | number, fieldPath?: string): Serial {
  if (typeof input === "number") {
    return asSerial(input, fieldPath);
  }
  if (typeof input !== "string" || !CANONICAL_HEX_PATTERN.test(input)) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_SERIAL,
      `Invalid canonical serial string: ${String(input)}`,
      { ...(fieldPath !== undefined ? { fieldPath } : {}), details: { received: input } },
    );
  }
  return Number.parseInt(input.slice(2), 16) as Serial;
}

function assertBinaryRange(bytes: Uint8Array, offset: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset + 4 > bytes.byteLength) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_SERIAL,
      `Buffer too short for 4-byte serial at offset ${String(offset)} (length=${String(bytes.byteLength)})`,
      { details: { byteLength: bytes.byteLength, offset } },
    );
  }
}

export function writeSerialBE(
  serial: Serial | number,
  target: Uint8Array = new Uint8Array(4),
  offset = 0,
): Uint8Array {
  const validated = asSerial(serial);
  assertBinaryRange(target, offset);
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
  view.setUint32(offset, validated, false);
  return target;
}

export function readSerialBE(bytes: Uint8Array, offset = 0): Serial {
  assertBinaryRange(bytes, offset);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(offset, false) as Serial;
}

export function writeSerialLE(
  serial: Serial | number,
  target: Uint8Array = new Uint8Array(4),
  offset = 0,
): Uint8Array {
  const validated = asSerial(serial);
  assertBinaryRange(target, offset);
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
  view.setUint32(offset, validated, true);
  return target;
}

export function readSerialLE(bytes: Uint8Array, offset = 0): Serial {
  assertBinaryRange(bytes, offset);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(offset, true) as Serial;
}
