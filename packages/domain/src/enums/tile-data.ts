import { DomainError, DomainErrorCode } from "../errors/domain-error.js";

export const TileKind = {
  Land: "Land",
  Static: "Static",
  DynamicItem: "DynamicItem",
} as const;

export type TileKind = (typeof TileKind)[keyof typeof TileKind];

export type LandId = number & { readonly __brand: "LandId" };
export type ItemId = number & { readonly __brand: "ItemId" };
export type MultiId = number & { readonly __brand: "MultiId" };

export const LAND_ID_MAX = 0x3fff;
export const ITEM_ID_MAX = 0xffff;
export const MULTI_ID_MAX = 0x3fff;

export const NO_DRAW_LAND_ID = 0x0002 as LandId;
export const NO_DRAW_ITEM_ID = 0x0001 as ItemId;

export function asLandId(value: unknown, fieldPath?: string): LandId {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > LAND_ID_MAX) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_GRAPHIC_ID,
      `LandId must be an integer in [0x0000, 0x3FFF], received ${String(value)}`,
      {
        ...(fieldPath !== undefined ? { fieldPath } : {}),
        details: { kind: "LandId", received: value },
      },
    );
  }
  return value as LandId;
}

export function asItemId(value: unknown, fieldPath?: string): ItemId {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > ITEM_ID_MAX) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_GRAPHIC_ID,
      `ItemId must be an integer in [0x0000, 0xFFFF], received ${String(value)}`,
      {
        ...(fieldPath !== undefined ? { fieldPath } : {}),
        details: { kind: "ItemId", received: value },
      },
    );
  }
  return value as ItemId;
}

export function asMultiId(value: unknown, fieldPath?: string): MultiId {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MULTI_ID_MAX) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_GRAPHIC_ID,
      `MultiId must be an integer in [0x0000, 0x3FFF], received ${String(value)}`,
      {
        ...(fieldPath !== undefined ? { fieldPath } : {}),
        details: { kind: "MultiId", received: value },
      },
    );
  }
  return value as MultiId;
}

export function isNoDrawLand(id: LandId | number): boolean {
  return asLandId(id) === NO_DRAW_LAND_ID;
}

export function isNoDrawItem(id: ItemId | number): boolean {
  return asItemId(id) === NO_DRAW_ITEM_ID;
}

export type TileFlags = bigint & { readonly __brand: "TileFlags" };

export const TILE_FLAGS_MIN = 0n;
export const TILE_FLAGS_MAX = 0xffffffffffffffffn;
export const TILE_FLAGS_NONE = 0n as TileFlags;

export const TileFlag = Object.freeze({
  Background: 1n << 0n,
  Weapon: 1n << 1n,
  Transparent: 1n << 2n,
  Translucent: 1n << 3n,
  Wall: 1n << 4n,
  Damaging: 1n << 5n,
  Impassable: 1n << 6n,
  Wet: 1n << 7n,
  Unknown1: 1n << 8n,
  Surface: 1n << 9n,
  Bridge: 1n << 10n,
  Generic: 1n << 11n,
  Window: 1n << 12n,
  NoShoot: 1n << 13n,
  ArticleA: 1n << 14n,
  ArticleAn: 1n << 15n,
  Internal: 1n << 16n,
  Foliage: 1n << 17n,
  PartialHue: 1n << 18n,
  NoHouse: 1n << 19n,
  Map: 1n << 20n,
  Container: 1n << 21n,
  Wearable: 1n << 22n,
  LightSource: 1n << 23n,
  Animation: 1n << 24n,
  HoverOver: 1n << 25n,
  NoDiagonal: 1n << 26n,
  Armor: 1n << 27n,
  Roof: 1n << 28n,
  Door: 1n << 29n,
  StairBack: 1n << 30n,
  StairRight: 1n << 31n,
  AlphaBlend: 1n << 32n,
  UseNewArt: 1n << 33n,
  ArtUsed: 1n << 34n,
  NoShadow: 1n << 35n,
  PixelBleed: 1n << 36n,
  PlayAnimOnce: 1n << 37n,
  Unknown2: 1n << 38n,
  Unknown3: 1n << 39n,
  MultiMovable: 1n << 40n,
} as const);

export type TileFlagName = keyof typeof TileFlag;

const TILE_FLAG_ENTRIES = Object.entries(TileFlag) as readonly [TileFlagName, bigint][];
const TILE_FLAGS_HEX_PATTERN = /^0x[0-9a-fA-F]{1,16}$/;

export function asTileFlags(value: bigint, fieldPath?: string): TileFlags {
  if (typeof value !== "bigint" || value < TILE_FLAGS_MIN || value > TILE_FLAGS_MAX) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_TILE_FLAGS,
      `TileFlags must be an unsigned 64-bit bigint (0n..0xFFFFFFFFFFFFFFFFn), received ${String(value)}`,
      { ...(fieldPath !== undefined ? { fieldPath } : {}), details: { received: String(value) } },
    );
  }
  return value as TileFlags;
}

export function fromLegacyUint32Flags(flags32: number): TileFlags {
  if (!Number.isInteger(flags32) || flags32 < 0 || flags32 > 0xffffffff) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_TILE_FLAGS,
      `Legacy 32-bit tile flags must be uint32, received ${String(flags32)}`,
      { details: { received: flags32 } },
    );
  }
  return BigInt(flags32) as TileFlags;
}

export function hasTileFlag(flags: TileFlags | bigint, flag: bigint): boolean {
  return (asTileFlags(flags) & asTileFlags(flag)) !== 0n;
}

export function hasAnyTileFlag(flags: TileFlags | bigint, mask: bigint): boolean {
  return (asTileFlags(flags) & asTileFlags(mask)) !== 0n;
}

export function hasAllTileFlags(flags: TileFlags | bigint, mask: bigint): boolean {
  const m = asTileFlags(mask);
  return (asTileFlags(flags) & m) === m;
}

export function combineTileFlags(...flags: readonly bigint[]): TileFlags {
  let acc = 0n;
  for (const f of flags) {
    acc |= asTileFlags(f);
  }
  return acc as TileFlags;
}

export function tileFlagsToHex(flags: TileFlags | bigint): string {
  const valid = asTileFlags(flags);
  return `0x${valid.toString(16).toUpperCase().padStart(16, "0")}`;
}

export function parseTileFlagsHex(hex: string, fieldPath?: string): TileFlags {
  if (typeof hex !== "string" || !TILE_FLAGS_HEX_PATTERN.test(hex)) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_TILE_FLAGS,
      `Invalid 64-bit tile flags hex string: "${String(hex)}"`,
      { ...(fieldPath !== undefined ? { fieldPath } : {}), details: { received: hex } },
    );
  }
  return asTileFlags(BigInt(hex), fieldPath);
}

export function tileFlagsToNames(flags: TileFlags | bigint): readonly TileFlagName[] {
  const valid = asTileFlags(flags);
  const names: TileFlagName[] = [];
  for (const [name, bit] of TILE_FLAG_ENTRIES) {
    if ((valid & bit) !== 0n) {
      names.push(name);
    }
  }
  return names;
}

export function namesToTileFlags(names: readonly TileFlagName[]): TileFlags {
  let acc = 0n;
  for (const name of names) {
    const bit = TileFlag[name];
    if (bit === undefined) {
      throw new DomainError(
        DomainErrorCode.ERR_INVALID_TILE_FLAGS,
        `Unknown TileFlag name: "${String(name)}"`,
        { details: { name } },
      );
    }
    acc |= bit;
  }
  return acc as TileFlags;
}

function assertFlagsByteLength(bytes: Uint8Array, offset: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset + 8 > bytes.byteLength) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_TILE_FLAGS,
      `Buffer too short for 8-byte TileFlags at offset ${String(offset)} (length=${String(bytes.byteLength)})`,
    );
  }
}

export function writeTileFlagsBE(
  flags: TileFlags | bigint,
  target: Uint8Array = new Uint8Array(8),
  offset = 0,
): Uint8Array {
  const valid = asTileFlags(flags);
  assertFlagsByteLength(target, offset);
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
  view.setBigUint64(offset, valid, false);
  return target;
}

export function readTileFlagsBE(bytes: Uint8Array, offset = 0): TileFlags {
  assertFlagsByteLength(bytes, offset);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getBigUint64(offset, false) as TileFlags;
}

export function writeTileFlagsLE(
  flags: TileFlags | bigint,
  target: Uint8Array = new Uint8Array(8),
  offset = 0,
): Uint8Array {
  const valid = asTileFlags(flags);
  assertFlagsByteLength(target, offset);
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
  view.setBigUint64(offset, valid, true);
  return target;
}

export function readTileFlagsLE(bytes: Uint8Array, offset = 0): TileFlags {
  assertFlagsByteLength(bytes, offset);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getBigUint64(offset, true) as TileFlags;
}

export interface LandTileData {
  readonly id: LandId;
  readonly flags: TileFlags;
  readonly textureId: number;
  readonly name: string;
}

export interface ItemTileData {
  readonly id: ItemId;
  readonly flags: TileFlags;
  readonly weight: number;
  readonly quality: number;
  readonly quantity: number;
  readonly animId: number;
  readonly hue: number;
  readonly value: number;
  readonly height: number;
  readonly name: string;
}

export function calcTileHeight(itemTile: Pick<ItemTileData, "flags" | "height">): number {
  if (hasTileFlag(itemTile.flags, TileFlag.Bridge)) {
    return Math.floor(itemTile.height / 2);
  }
  return itemTile.height;
}

export function isTileImpassable(tile: Pick<LandTileData | ItemTileData, "flags">): boolean {
  return hasTileFlag(tile.flags, TileFlag.Impassable);
}

export function isTileClimbableSurface(tile: Pick<ItemTileData, "flags">): boolean {
  return hasAnyTileFlag(tile.flags, TileFlag.Surface | TileFlag.Bridge);
}

export function doesTileBlockLos(tile: Pick<LandTileData | ItemTileData, "flags">): boolean {
  if (hasTileFlag(tile.flags, TileFlag.Window)) {
    return false;
  }
  return hasAnyTileFlag(tile.flags, TileFlag.NoShoot | TileFlag.Impassable);
}
