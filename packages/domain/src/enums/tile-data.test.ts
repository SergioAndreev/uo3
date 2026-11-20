import { describe, expect, it } from "vitest";
import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import {
  asItemId,
  asLandId,
  asMultiId,
  asTileFlags,
  calcTileHeight,
  combineTileFlags,
  doesTileBlockLos,
  fromLegacyUint32Flags,
  hasAllTileFlags,
  hasAnyTileFlag,
  hasTileFlag,
  isNoDrawItem,
  isNoDrawLand,
  isTileClimbableSurface,
  isTileImpassable,
  ItemTileDataValidator,
  LandTileDataValidator,
  namesToTileFlags,
  parseTileFlagsHex,
  readTileFlagsBE,
  readTileFlagsLE,
  TileFlag,
  TileFlagsHexValidator,
  tileFlagsToHex,
  tileFlagsToNames,
  TileKind,
  writeTileFlagsBE,
  writeTileFlagsLE,
  type ItemTileData,
  type TileFlagName,
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

describe("domain/core-enumerations — TileKind, Graphic IDs, 64-bit TileFlags & TileData", () => {
  it("validates LandId, ItemId, MultiId bounds and recognizes NoDraw markers", () => {
    expect(TileKind.Land).toBe("Land");
    expect(TileKind.Static).toBe("Static");
    expect(TileKind.DynamicItem).toBe("DynamicItem");

    expect(asLandId(0x3fff)).toBe(0x3fff);
    expect(asItemId(0xffff)).toBe(0xffff);
    expect(asMultiId(0x3fff)).toBe(0x3fff);

    expectDomainCode(() => asLandId(0x4000, "landId"), DomainErrorCode.ERR_INVALID_GRAPHIC_ID);
    expectDomainCode(() => asItemId(0x10000, "itemId"), DomainErrorCode.ERR_INVALID_GRAPHIC_ID);
    expectDomainCode(() => asMultiId(0x4000, "multiId"), DomainErrorCode.ERR_INVALID_GRAPHIC_ID);

    expect(isNoDrawLand(0x0002)).toBe(true);
    expect(isNoDrawLand(0x0003)).toBe(false);
    expect(isNoDrawItem(0x0001)).toBe(true);
    expect(isNoDrawItem(0x0002)).toBe(false);
  });

  it("ensures unique 64-bit TileFlag positions, legacy 32-bit lift, and lossless JSON/binary codecs", () => {
    const bits = Object.values(TileFlag);
    expect(new Set(bits).size).toBe(bits.length);

    const legacy = fromLegacyUint32Flags(0x00200240);
    expect(legacy >> 32n).toBe(0n);
    expect(
      hasAllTileFlags(legacy, TileFlag.Impassable | TileFlag.Surface | TileFlag.Container),
    ).toBe(true);
    expectDomainCode(() => fromLegacyUint32Flags(-1), DomainErrorCode.ERR_INVALID_TILE_FLAGS);

    const mask64 = combineTileFlags(
      TileFlag.Impassable,
      TileFlag.Surface,
      TileFlag.MultiMovable,
      1n << 63n,
    );
    const hex = tileFlagsToHex(mask64);
    expect(TileFlagsHexValidator.Check(hex)).toBe(true);
    const restored = parseTileFlagsHex(hex);
    expect(restored).toBe(mask64);
    expect(hasTileFlag(restored, TileFlag.Impassable)).toBe(true);
    expect(hasTileFlag(restored, TileFlag.Surface)).toBe(true);
    expect(hasTileFlag(restored, TileFlag.MultiMovable)).toBe(true);
    expect(hasTileFlag(restored, TileFlag.Roof)).toBe(false);

    expect(readTileFlagsBE(writeTileFlagsBE(mask64))).toBe(mask64);
    expect(readTileFlagsLE(writeTileFlagsLE(mask64))).toBe(mask64);

    const namedMask = combineTileFlags(
      TileFlag.Impassable,
      TileFlag.Surface,
      TileFlag.MultiMovable,
    );
    const names = tileFlagsToNames(namedMask);
    expect(names).toEqual(["Impassable", "Surface", "MultiMovable"]);
    expect(namesToTileFlags(names)).toBe(namedMask);

    expectDomainCode(() => asTileFlags(-1n, "flags"), DomainErrorCode.ERR_INVALID_TILE_FLAGS);
    expectDomainCode(() => asTileFlags(1n << 64n), DomainErrorCode.ERR_INVALID_TILE_FLAGS);
    expectDomainCode(
      () => parseTileFlagsHex("1234", "flags"),
      DomainErrorCode.ERR_INVALID_TILE_FLAGS,
    );
    expectDomainCode(
      () => namesToTileFlags(["NotAFlag" as TileFlagName]),
      DomainErrorCode.ERR_INVALID_TILE_FLAGS,
    );
    expectDomainCode(
      () => readTileFlagsBE(new Uint8Array(7)),
      DomainErrorCode.ERR_INVALID_TILE_FLAGS,
    );
  });

  it("computes derived passability, Bridge height halving, and Window/NoShoot LOS rules", () => {
    const stair: ItemTileData = {
      id: asItemId(0x0700),
      flags: combineTileFlags(TileFlag.Surface, TileFlag.Bridge),
      weight: 255,
      quality: 0,
      quantity: 0,
      animId: 0,
      hue: 0,
      value: 0,
      height: 5,
      name: "stone stairs",
    };
    const platform: ItemTileData = { ...stair, flags: combineTileFlags(TileFlag.Surface) };
    expect(calcTileHeight(stair)).toBe(2);
    expect(calcTileHeight(platform)).toBe(5);
    expect(isTileClimbableSurface(stair)).toBe(true);

    const wall = { flags: combineTileFlags(TileFlag.Wall, TileFlag.Impassable, TileFlag.NoShoot) };
    const windowTile = {
      flags: combineTileFlags(TileFlag.Wall, TileFlag.Impassable, TileFlag.Window),
    };
    expect(isTileImpassable(wall)).toBe(true);
    expect(doesTileBlockLos(wall)).toBe(true);
    expect(isTileImpassable(windowTile)).toBe(true);
    expect(doesTileBlockLos(windowTile)).toBe(false);

    expect(
      LandTileDataValidator.Check({
        id: 3,
        flags: tileFlagsToHex(TileFlag.Background),
        textureId: 12,
        name: "grass",
      }),
    ).toBe(true);
    expect(
      ItemTileDataValidator.Check({
        ...stair,
        flags: tileFlagsToHex(stair.flags),
      }),
    ).toBe(true);
    expect(
      LandTileDataValidator.Check({
        id: 3,
        flags: "INVALID",
        textureId: 12,
        name: "grass",
      }),
    ).toBe(false);
  });

  it("passes property-based round-trip tests on random 64-bit TileFlags masks", () => {
    let s = 0xdeadbeef;
    const nextU32 = (): bigint => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return BigInt(s);
    };

    for (let i = 0; i < 1000; i += 1) {
      const mask = asTileFlags((nextU32() << 32n) | nextU32());
      expect(parseTileFlagsHex(tileFlagsToHex(mask))).toBe(mask);
      expect(readTileFlagsBE(writeTileFlagsBE(mask))).toBe(mask);
      expect(readTileFlagsLE(writeTileFlagsLE(mask))).toBe(mask);
      expect(hasAnyTileFlag(mask, mask)).toBe(mask !== 0n);
      expect(hasAllTileFlags(mask, mask)).toBe(true);
    }
  });
});
