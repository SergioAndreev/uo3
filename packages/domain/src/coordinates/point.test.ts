import { describe, expect, it } from "vitest";
import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import {
  assertInFacetBounds,
  createPoint2D,
  createPoint3D,
  createRect2D,
  createWorldLocation,
  FACET_FELUCCA,
  FACET_ILSHENAR,
  FACET_INTERNAL,
  FACET_MALAS,
  FACET_TERMUR,
  FACET_TOKUNO,
  FACET_TRAMMEL,
  getCoveringSectors,
  getFacet,
  getFacetMapBlockGrid,
  getFacetSectorGrid,
  listFacets,
  offsetPoint3D,
  packSectorKey,
  Point2DValidator,
  Point3DValidator,
  POINT3D_BYTE_LENGTH,
  readPoint3D,
  readWorldLocation,
  rectClampToFacet,
  rectContains,
  rectIntersects,
  Rect2DValidator,
  registerSyntheticFacet,
  toBlockCellIndex,
  toMapBlockCoord,
  toSectorCoord,
  unpackSectorKey,
  unregisterSyntheticFacet,
  validatePartitionBounds,
  WORLD_LOCATION_BYTE_LENGTH,
  WorldLocationValidator,
  writePoint3D,
  writeWorldLocation,
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

describe("domain/world-coordinates — Point, Facet, Bounds, Sectors, Blocks & Binary Codecs", () => {
  it("creates immutable Point2D/Point3D, offsets immutably, and validates boundaries", () => {
    const p2 = createPoint2D(10, 20);
    expect(Object.isFrozen(p2)).toBe(true);

    const p = createPoint3D(1495, 1629, 10);
    const moved = offsetPoint3D(p, 1, -1, 2);
    expect(moved).toEqual({ x: 1496, y: 1628, z: 12 });
    expect(p).toEqual({ x: 1495, y: 1629, z: 10 });

    expect(createPoint3D(0, 0, -128).z).toBe(-128);
    expect(createPoint3D(65535, 65535, 127).z).toBe(127);

    for (const bad of [10.5, -1, 65536, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectDomainCode(() => createPoint3D(bad, 0, 0), DomainErrorCode.ERR_INVALID_COORDINATE);
      expectDomainCode(() => createPoint3D(0, bad, 0), DomainErrorCode.ERR_INVALID_COORDINATE);
    }
    for (const badZ of [-129, 128, 1.5, Number.NaN]) {
      expectDomainCode(() => createPoint3D(0, 0, badZ), DomainErrorCode.ERR_Z_OUT_OF_RANGE);
    }
    expectDomainCode(() => offsetPoint3D(p, 0.5, 0, 0), DomainErrorCode.ERR_INVALID_COORDINATE);
    expectDomainCode(() => offsetPoint3D(p, 0, 0, 0.5), DomainErrorCode.ERR_Z_OUT_OF_RANGE);
  });

  it("provides canonical built-in facets and validates synthetic facets (200..254, multiple of 16, >= 64)", () => {
    expect(getFacet(FACET_FELUCCA)).toMatchObject({
      id: 0,
      name: "Felucca",
      width: 7168,
      height: 4096,
      rules: "FeluccaPvP",
    });
    expect(getFacet(FACET_TRAMMEL)).toMatchObject({
      id: 1,
      name: "Trammel",
      width: 7168,
      height: 4096,
      rules: "TrammelSafe",
    });
    expect(getFacet(FACET_ILSHENAR)).toMatchObject({ width: 2304, height: 1600 });
    expect(getFacet(FACET_MALAS)).toMatchObject({ width: 2560, height: 2048 });
    expect(getFacet(FACET_TOKUNO)).toMatchObject({ width: 1448, height: 1448 });
    expect(getFacet(FACET_TERMUR)).toMatchObject({ width: 1280, height: 4096 });
    expect(getFacet(FACET_INTERNAL)).toMatchObject({ id: 127, rules: "Internal" });
    expect(listFacets().length).toBeGreaterThanOrEqual(7);

    expectDomainCode(() => getFacet(99), DomainErrorCode.ERR_UNKNOWN_FACET);

    const syn = registerSyntheticFacet({ id: 200, name: "SyntheticTest", width: 256, height: 256 });
    expect(syn).toMatchObject({ id: 200, width: 256, height: 256, synthetic: true });
    expect(getFacet(200).name).toBe("SyntheticTest");
    expect(unregisterSyntheticFacet(200)).toBe(true);

    expectDomainCode(
      () => registerSyntheticFacet({ id: 201, name: "BadSmall", width: 50, height: 50 }),
      DomainErrorCode.ERR_INVALID_FACET_DIMENSIONS,
    );
    expectDomainCode(
      () => registerSyntheticFacet({ id: 201, name: "BadUnaligned", width: 64, height: 70 }),
      DomainErrorCode.ERR_INVALID_FACET_DIMENSIONS,
    );
    expectDomainCode(
      () => registerSyntheticFacet({ id: 201, name: "BadTiny", width: 32, height: 32 }),
      DomainErrorCode.ERR_INVALID_FACET_DIMENSIONS,
    );
    expectDomainCode(
      () => registerSyntheticFacet({ id: 100, name: "BadId", width: 128, height: 128 }),
      DomainErrorCode.ERR_UNKNOWN_FACET,
    );
  });

  it("enforces facet bounds, half-open Rect2D operations, and 16-tile partition alignment", () => {
    expect(createWorldLocation(FACET_FELUCCA, 0, 0, 0)).toEqual({ facet: 0, x: 0, y: 0, z: 0 });
    expect(createWorldLocation(FACET_FELUCCA, 7167, 4095, 0)).toEqual({
      facet: 0,
      x: 7167,
      y: 4095,
      z: 0,
    });
    expectDomainCode(
      () => assertInFacetBounds(createPoint3D(7168, 4095, 0), FACET_FELUCCA),
      DomainErrorCode.ERR_OUT_OF_MAP_BOUNDS,
    );

    const rect = createRect2D(100, 200, 32, 16);
    expect(rectContains(rect, createPoint2D(100, 200))).toBe(true);
    expect(rectContains(rect, createPoint2D(131, 215))).toBe(true);
    expect(rectContains(rect, createPoint2D(132, 200))).toBe(false);
    expect(rectContains(rect, createPoint2D(100, 216))).toBe(false);

    expect(rectIntersects(rect, createRect2D(130, 210, 10, 10))).toBe(true);
    expect(rectIntersects(rect, createRect2D(132, 200, 10, 10))).toBe(false);
    expect(rectIntersects(rect, createRect2D(100, 200, 0, 10))).toBe(false);

    const clamped = rectClampToFacet(createRect2D(7100, 4050, 200, 200), FACET_FELUCCA);
    expect(clamped).toEqual({ x: 7100, y: 4050, width: 68, height: 46 });

    expect(() =>
      validatePartitionBounds(createRect2D(0, 0, 3584, 4096), FACET_FELUCCA),
    ).not.toThrow();
    expectDomainCode(
      () => validatePartitionBounds(createRect2D(8, 0, 1024, 1024), FACET_FELUCCA),
      DomainErrorCode.ERR_UNALIGNED_PARTITION_BOUNDS,
    );
    expectDomainCode(
      () => validatePartitionBounds(createRect2D(7040, 0, 256, 256), FACET_FELUCCA),
      DomainErrorCode.ERR_OUT_OF_MAP_BOUNDS,
    );
  });

  it("computes 16x16 sectors, 8x8 map blocks, covering AOI sectors, and 32-bit sector keys", () => {
    const pt = createPoint2D(35, 19);
    expect(toSectorCoord(pt)).toEqual({ sectorX: 2, sectorY: 1 });
    expect(toMapBlockCoord(pt)).toEqual({ blockX: 4, blockY: 2 });
    expect(toBlockCellIndex(pt)).toBe(27);

    const grid = getFacetSectorGrid(FACET_FELUCCA);
    expect(grid).toEqual({ width: 448, height: 256, total: 114_688 });

    const blockGrid = getFacetMapBlockGrid(FACET_FELUCCA);
    expect(blockGrid).toEqual({ width: 896, height: 512, total: 458_752 });

    const covering = getCoveringSectors(createPoint2D(5, 5), 18, FACET_FELUCCA);
    expect(covering).toEqual([
      { sectorX: 0, sectorY: 0 },
      { sectorX: 1, sectorY: 0 },
      { sectorX: 0, sectorY: 1 },
      { sectorX: 1, sectorY: 1 },
    ]);

    expectDomainCode(
      () => getCoveringSectors(createPoint2D(5, 5), -1, FACET_FELUCCA),
      DomainErrorCode.ERR_INVALID_RANGE,
    );
    expectDomainCode(() => packSectorKey(-1, 0), DomainErrorCode.ERR_INVALID_COORDINATE);
    expectDomainCode(() => unpackSectorKey(-1), DomainErrorCode.ERR_INVALID_COORDINATE);
  });

  it("encodes/decodes 5-byte Point3D, 6-byte WorldLocation, and validates TypeBox schemas", () => {
    const loc = createWorldLocation(FACET_TRAMMEL, 7167, 4095, -120);
    const bytes = writeWorldLocation(loc);
    expect(bytes.byteLength).toBe(WORLD_LOCATION_BYTE_LENGTH);
    expect(readWorldLocation(bytes)).toEqual(loc);

    const ptBytes = writePoint3D(createPoint3D(1495, 1629, -128));
    expect(ptBytes.byteLength).toBe(POINT3D_BYTE_LENGTH);
    expect(readPoint3D(ptBytes)).toEqual({ x: 1495, y: 1629, z: -128 });

    expectDomainCode(() => readPoint3D(new Uint8Array(4)), DomainErrorCode.ERR_INVALID_COORDINATE);
    expectDomainCode(
      () => readWorldLocation(new Uint8Array(5)),
      DomainErrorCode.ERR_INVALID_COORDINATE,
    );

    expect(Point2DValidator.Check({ x: 10, y: 20 })).toBe(true);
    expect(Point3DValidator.Check({ x: 10, y: 20, z: -128 })).toBe(true);
    expect(Point3DValidator.Check({ x: 10, y: 20, z: 128 })).toBe(false);
    expect(Rect2DValidator.Check({ x: 0, y: 0, width: 16, height: 16 })).toBe(true);
    expect(WorldLocationValidator.Check({ facet: 1, x: 10, y: 20, z: 0 })).toBe(true);
  });

  it("passes seeded property-based tests for binary round-trip, packSectorKey, and getCoveringSectors", () => {
    let s = 0x517cc1b7;
    const next = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s;
    };

    const felucca = getFacet(FACET_FELUCCA);
    for (let i = 0; i < 2000; i += 1) {
      const x = next() % felucca.width;
      const y = next() % felucca.height;
      const z = (next() % 256) - 128;
      const loc = createWorldLocation(FACET_FELUCCA, x, y, z);

      expect(readWorldLocation(writeWorldLocation(loc))).toEqual(loc);
      expect(readPoint3D(writePoint3D(loc))).toEqual({ x, y, z });

      const sec = toSectorCoord(loc);
      expect(unpackSectorKey(packSectorKey(sec.sectorX, sec.sectorY))).toEqual(sec);

      const sectors = getCoveringSectors(loc, 18, felucca);
      expect(sectors.length).toBeGreaterThanOrEqual(1);
      expect(sectors.some((sc) => sc.sectorX === sec.sectorX && sc.sectorY === sec.sectorY)).toBe(
        true,
      );
    }
  });
});
