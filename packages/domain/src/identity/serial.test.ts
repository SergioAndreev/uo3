import { describe, expect, it } from "vitest";
import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import {
  asEphemeralSerial,
  asItemSerial,
  asMobileSerial,
  asSerial,
  compareSerials,
  EPHEMERAL_SERIAL_MAX,
  EPHEMERAL_SERIAL_MIN,
  formatSerial,
  getSerialKind,
  isEphemeralSerial,
  isItemSerial,
  isMobileSerial,
  isNullSerial,
  isReservedSerial,
  isSentinelSerial,
  isValidEntitySerial,
  ITEM_SERIAL_MAX,
  ITEM_SERIAL_MIN,
  ItemSerialValidator,
  MOBILE_SERIAL_MAX,
  MOBILE_SERIAL_MIN,
  MobileSerialValidator,
  parseSerial,
  readSerialBE,
  readSerialLE,
  SERIAL_NULL,
  SERIAL_SENTINEL,
  serialEquals,
  SerialHexValidator,
  SerialNumberValidator,
  writeSerialBE,
  writeSerialLE,
  type ItemSerial,
  type MobileSerial,
} from "./index.js";

function expectDomainCode(fn: () => unknown, code: DomainErrorCode): void {
  try {
    fn();
    expect.unreachable(`Expected DomainError(${code})`);
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
  }
}

describe("domain/entity-identity — Serial classification, validation, order, and codecs", () => {
  it("classifies all range boundaries accurately (mobile, item, null, ephemeral, sentinel)", () => {
    expect(getSerialKind(SERIAL_NULL)).toBe("null");
    expect(getSerialKind(MOBILE_SERIAL_MIN)).toBe("mobile");
    expect(getSerialKind(MOBILE_SERIAL_MAX)).toBe("mobile");
    expect(getSerialKind(ITEM_SERIAL_MIN)).toBe("item");
    expect(getSerialKind(ITEM_SERIAL_MAX)).toBe("item");
    expect(getSerialKind(EPHEMERAL_SERIAL_MIN)).toBe("ephemeral");
    expect(getSerialKind(EPHEMERAL_SERIAL_MAX)).toBe("ephemeral");
    expect(getSerialKind(SERIAL_SENTINEL)).toBe("sentinel");

    expect(isNullSerial(0)).toBe(true);
    expect(isValidEntitySerial(0)).toBe(false);
    expect(isMobileSerial(0x00000001)).toBe(true);
    expect(isMobileSerial(0x3fffffff)).toBe(true);
    expect(isItemSerial(0x40000000)).toBe(true);
    expect(isItemSerial(0x7fffffff)).toBe(true);
    expect(isValidEntitySerial(0x40000000)).toBe(true);
    expect(isEphemeralSerial(0x80000000)).toBe(true);
    expect(isEphemeralSerial(0xfffffffe)).toBe(true);
    expect(isSentinelSerial(0xffffffff)).toBe(true);
    expect(isReservedSerial(0x80000000)).toBe(true);
    expect(isReservedSerial(0xffffffff)).toBe(true);
    expect(isValidEntitySerial(0x80000000)).toBe(false);
    expect(isValidEntitySerial(0xffffffff)).toBe(false);
  });

  it("enforces compile-time branding and strict runtime validation", () => {
    const mobile: MobileSerial = asMobileSerial(0x00000001);
    const item: ItemSerial = asItemSerial(0x40000010);
    const ephemeral = asEphemeralSerial(0x80000001);

    // @ts-expect-error ItemSerial must not be assignable to MobileSerial
    const _cannotMix: MobileSerial = item;
    void _cannotMix;
    expect(mobile).toBe(1);
    expect(ephemeral).toBe(0x80000001);

    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x100000000, "1", null]) {
      expectDomainCode(() => asSerial(bad, "serial"), DomainErrorCode.ERR_INVALID_SERIAL);
    }

    expectDomainCode(
      () => asMobileSerial(0x40000010, "mobile"),
      DomainErrorCode.ERR_SERIAL_KIND_MISMATCH,
    );
    expectDomainCode(
      () => asItemSerial(0x00000000, "item"),
      DomainErrorCode.ERR_SERIAL_KIND_MISMATCH,
    );
    expectDomainCode(
      () => asEphemeralSerial(0xffffffff, "ephemeral"),
      DomainErrorCode.ERR_SERIAL_KIND_MISMATCH,
    );
  });

  it("compares serials in strict unsigned linear order without int32 sign overflow", () => {
    const input = [0x80000001, 0x40000000, 0x00000000, 0x3fffffff, 0x00000001, 0xffffffff];
    const sorted = [...input].sort(compareSerials);
    expect(sorted).toEqual([
      0x00000000, 0x00000001, 0x3fffffff, 0x40000000, 0x80000001, 0xffffffff,
    ]);

    expect(compareSerials(0x00000005, 0x40000001)).toBe(-1);
    expect(compareSerials(0x40000001, 0x7fffffff)).toBe(-1);
    expect(compareSerials(0x00000005, 0x7fffffff)).toBe(-1);
    expect(compareSerials(0x7fffffff, 0x00000005)).toBe(1);
    expect(compareSerials(0x4000002a, 0x4000002a)).toBe(0);
    expect(serialEquals(0x4000002a, 0x4000002a)).toBe(true);
    expect(serialEquals(0x4000002a, 0x4000002b)).toBe(false);
  });

  it("formats and parses canonical hex strings strictly", () => {
    expect(formatSerial(1073741866)).toBe("0x4000002A");
    expect(formatSerial(0)).toBe("0x00000000");
    expect(formatSerial(0xffffffff)).toBe("0xFFFFFFFF");

    expect(parseSerial("0x4000002A")).toBe(0x4000002a);
    expect(parseSerial("0x4000002a")).toBe(0x4000002a);
    expect(parseSerial(0x4000002a)).toBe(0x4000002a);

    for (const bad of ["4000002A", "0x4000", " 0x00000001", "+0x00000001", "0xGGGGGGGG", ""]) {
      expectDomainCode(() => parseSerial(bad, "id"), DomainErrorCode.ERR_INVALID_SERIAL);
    }
  });

  it("performs bitwise-exact 4-byte BE and LE binary serialization and rejects short buffers", () => {
    const be = writeSerialBE(0x401234ab);
    expect(Array.from(be)).toEqual([0x40, 0x12, 0x34, 0xab]);
    expect(readSerialBE(be)).toBe(0x401234ab);

    const le = writeSerialLE(0x401234ab);
    expect(Array.from(le)).toEqual([0xab, 0x34, 0x12, 0x40]);
    expect(readSerialLE(le)).toBe(0x401234ab);

    const padded = new Uint8Array(10);
    writeSerialBE(0xffffffff, padded, 3);
    expect(readSerialBE(padded, 3)).toBe(0xffffffff);
    writeSerialLE(0x80000001, padded, 6);
    expect(readSerialLE(padded, 6)).toBe(0x80000001);

    expectDomainCode(() => readSerialBE(new Uint8Array(3)), DomainErrorCode.ERR_INVALID_SERIAL);
    expectDomainCode(() => readSerialLE(new Uint8Array(2)), DomainErrorCode.ERR_INVALID_SERIAL);
    expectDomainCode(
      () => writeSerialBE(1, new Uint8Array(4), 1),
      DomainErrorCode.ERR_INVALID_SERIAL,
    );
  });

  it("validates TypeBox schemas for SerialNumber, SerialHex, MobileSerial, and ItemSerial", () => {
    expect(SerialNumberValidator.Check(0)).toBe(true);
    expect(SerialNumberValidator.Check(0xffffffff)).toBe(true);
    expect(SerialNumberValidator.Check(-1)).toBe(false);
    expect(SerialNumberValidator.Check(0x100000000)).toBe(false);

    expect(SerialHexValidator.Check("0x4000002A")).toBe(true);
    expect(SerialHexValidator.Check("0x4000002a")).toBe(true);
    expect(SerialHexValidator.Check("4000002A")).toBe(false);
    expect(SerialHexValidator.Check("0x4000")).toBe(false);

    expect(MobileSerialValidator.Check(0x00000001)).toBe(true);
    expect(MobileSerialValidator.Check(0x3fffffff)).toBe(true);
    expect(MobileSerialValidator.Check(0)).toBe(false);
    expect(MobileSerialValidator.Check(0x40000000)).toBe(false);

    expect(ItemSerialValidator.Check(0x40000000)).toBe(true);
    expect(ItemSerialValidator.Check(0x7fffffff)).toBe(true);
    expect(ItemSerialValidator.Check(0x3fffffff)).toBe(false);
    expect(ItemSerialValidator.Check(0x80000000)).toBe(false);
  });

  it("passes 10,000-iteration seeded property-based round-trip and total-order invariants", () => {
    let state = 0x12345678;
    const nextU32 = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };

    const bufBE = new Uint8Array(4);
    const bufLE = new Uint8Array(4);

    for (let i = 0; i < 10_000; i += 1) {
      const a = asSerial(nextU32());
      const b = asSerial(nextU32());
      const c = asSerial(nextU32());

      // Text round-trip
      const hex = formatSerial(a);
      expect(parseSerial(hex)).toBe(a);
      expect(parseSerial(hex.toLowerCase())).toBe(a);

      // Binary BE & LE round-trip
      writeSerialBE(a, bufBE, 0);
      expect(readSerialBE(bufBE, 0)).toBe(a);
      writeSerialLE(a, bufLE, 0);
      expect(readSerialLE(bufLE, 0)).toBe(a);

      // Antisymmetry & transitivity
      const ab = compareSerials(a, b);
      const ba = compareSerials(b, a);
      expect(ab).toBe(ba === 0 ? 0 : -ba);

      const bc = compareSerials(b, c);
      const ac = compareSerials(a, c);
      if (ab <= 0 && bc <= 0) {
        expect(ac).toBeLessThanOrEqual(0);
      }
    }
  });
});
