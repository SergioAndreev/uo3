import { describe, expect, it } from "vitest";
import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import {
  asDirection,
  canStepDeltaZ,
  chebyshevDistance,
  computeBaseDrawDepth,
  createPoint2D,
  createPoint3D,
  createWorldLocation,
  decodeDirection,
  Direction,
  DIRECTION_OFFSETS,
  DirectionByteValidator,
  encodeDirection,
  euclideanDistance,
  euclideanDistanceSquared,
  FACET_FELUCCA,
  FACET_TRAMMEL,
  getDirectionBetween,
  hasVerticalClearance,
  isInRange,
  isoScreenToWorld,
  manhattanDistance,
  PERSON_HEIGHT,
  readDirectionByte,
  reverseDirection,
  rotateDirection,
  STEP_HEIGHT,
  stepPoint,
  verticalDistance,
  verticalIntervalsOverlap,
  worldLocationDistance,
  worldToIsoScreen,
  writeDirectionByte,
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

describe("domain/world-coordinates — Directions, Distances, Isometric Projection & Clearance", () => {
  it("encodes, decodes, steps, rotates, reverses, and computes octant directions cleanly", () => {
    const runningSouth = encodeDirection(Direction.South, true);
    expect(runningSouth).toBe(0x84);
    expect(decodeDirection(0x84)).toEqual({ direction: Direction.South, running: true });
    expect(DIRECTION_OFFSETS[Direction.South]).toEqual({ dx: 0, dy: 1 });

    const buf = writeDirectionByte(Direction.South, true);
    expect(buf.byteLength).toBe(1);
    expect(readDirectionByte(buf)).toEqual({ direction: Direction.South, running: true });
    expectDomainCode(
      () => readDirectionByte(new Uint8Array(0)),
      DomainErrorCode.ERR_INVALID_DIRECTION,
    );
    expectDomainCode(
      () => writeDirectionByte(Direction.North, false, new Uint8Array(0)),
      DomainErrorCode.ERR_INVALID_DIRECTION,
    );

    for (const bad of [0x08, 0x40, -1, 256, 1.5]) {
      expectDomainCode(() => decodeDirection(bad), DomainErrorCode.ERR_INVALID_DIRECTION);
    }

    // All 256 possible byte values against DirectionByteSchema
    let validCount = 0;
    for (let b = 0; b < 256; b += 1) {
      const ok = DirectionByteValidator.Check(b);
      if (ok) {
        validCount += 1;
        expect(() => decodeDirection(b)).not.toThrow();
      } else {
        expectDomainCode(() => decodeDirection(b), DomainErrorCode.ERR_INVALID_DIRECTION);
      }
    }
    expect(validCount).toBe(16);

    expect(rotateDirection(Direction.Up, 2)).toBe(Direction.Right);
    expect(rotateDirection(Direction.North, -1)).toBe(Direction.Up);
    expect(reverseDirection(Direction.Right)).toBe(Direction.Left);
    expectDomainCode(() => asDirection(99), DomainErrorCode.ERR_INVALID_DIRECTION);
    expectDomainCode(() => asDirection(1.5), DomainErrorCode.ERR_INVALID_DIRECTION);
    expectDomainCode(
      () => rotateDirection(Direction.North, 1.5),
      DomainErrorCode.ERR_INVALID_DIRECTION,
    );
    expectDomainCode(() => decodeDirection(0x08), DomainErrorCode.ERR_INVALID_DIRECTION);
    expectDomainCode(() => decodeDirection(-1), DomainErrorCode.ERR_INVALID_DIRECTION);
    expectDomainCode(
      () => writeDirectionByte(Direction.North, false, new Uint8Array(0), 0),
      DomainErrorCode.ERR_INVALID_DIRECTION,
    );
    expectDomainCode(
      () => readDirectionByte(new Uint8Array(0), 0),
      DomainErrorCode.ERR_INVALID_DIRECTION,
    );

    const origin = createPoint3D(100, 100, 5);
    expect(stepPoint(origin, Direction.South)).toEqual({ x: 100, y: 101, z: 5 });
    expect(stepPoint(createPoint2D(100, 100), Direction.Right)).toEqual({ x: 101, y: 99 });

    // All 8 octants from (100, 100)
    expect(getDirectionBetween(origin, createPoint2D(100, 95))).toBe(Direction.North);
    expect(getDirectionBetween(origin, createPoint2D(105, 95))).toBe(Direction.Right);
    expect(getDirectionBetween(origin, createPoint2D(105, 100))).toBe(Direction.East);
    expect(getDirectionBetween(origin, createPoint2D(105, 105))).toBe(Direction.Down);
    expect(getDirectionBetween(origin, createPoint2D(100, 105))).toBe(Direction.South);
    expect(getDirectionBetween(origin, createPoint2D(95, 105))).toBe(Direction.Left);
    expect(getDirectionBetween(origin, createPoint2D(95, 100))).toBe(Direction.West);
    expect(getDirectionBetween(origin, createPoint2D(95, 95))).toBe(Direction.Up);
    expect(getDirectionBetween(origin, origin)).toBe(Direction.North);
  });

  it("computes Chebyshev, Manhattan, Euclidean, vertical distances and facet mismatch checks", () => {
    const a = createWorldLocation(FACET_FELUCCA, 100, 100, 5);
    const b = createWorldLocation(FACET_FELUCCA, 103, 104, 15);

    expect(chebyshevDistance(a, b)).toBe(4);
    expect(manhattanDistance(a, b)).toBe(7);
    expect(euclideanDistanceSquared(a, b)).toBe(25);
    expect(euclideanDistance(a, b)).toBe(5);
    expect(verticalDistance(a, b)).toBe(10);
    expect(worldLocationDistance(a, b)).toEqual({
      chebyshev: 4,
      manhattan: 7,
      euclideanSquared: 25,
      euclidean: 5,
      vertical: 10,
    });

    // AOI boundary 18 tiles
    expect(
      isInRange(
        createWorldLocation(FACET_FELUCCA, 100, 100, 0),
        createWorldLocation(FACET_FELUCCA, 118, 118, 0),
        18,
      ),
    ).toBe(true);
    expect(
      isInRange(
        createWorldLocation(FACET_FELUCCA, 100, 100, 0),
        createWorldLocation(FACET_FELUCCA, 119, 100, 0),
        18,
      ),
    ).toBe(false);

    // Cross-facet checks
    const fel = createWorldLocation(FACET_FELUCCA, 100, 100, 0);
    const tram = createWorldLocation(FACET_TRAMMEL, 100, 100, 0);
    expect(isInRange(fel, tram, 18)).toBe(false);
    expectDomainCode(() => worldLocationDistance(fel, tram), DomainErrorCode.ERR_FACET_MISMATCH);
  });

  it("projects isometric coordinates (44x44 px, Z step 4 px) and inverts accurately", () => {
    const p = createPoint3D(10, 4, 5);
    const screen = worldToIsoScreen(p);
    expect(screen).toEqual({ screenX: 132, screenY: 288 });
    expect(computeBaseDrawDepth(p)).toBe(14);
    expect(isoScreenToWorld(screen, 5)).toEqual({ x: 10, y: 4 });

    // East (+1, 0) -> (+22, +22), South (0, +1) -> (-22, +22)
    const base = worldToIsoScreen(createPoint3D(10, 10, 0));
    const east = worldToIsoScreen(createPoint3D(11, 10, 0));
    const south = worldToIsoScreen(createPoint3D(10, 11, 0));
    expect({ dx: east.screenX - base.screenX, dy: east.screenY - base.screenY }).toEqual({
      dx: 22,
      dy: 22,
    });
    expect({ dx: south.screenX - base.screenX, dy: south.screenY - base.screenY }).toEqual({
      dx: -22,
      dy: 22,
    });
  });

  it("checks vertical intervals, PersonHeight = 16 clearance, and StepHeight = 2 climbs", () => {
    expect(PERSON_HEIGHT).toBe(16);
    expect(STEP_HEIGHT).toBe(2);

    expect(verticalIntervalsOverlap(0, 16, 16, 4)).toBe(false);
    expect(verticalIntervalsOverlap(0, 16, 15, 5)).toBe(true);
    expect(verticalIntervalsOverlap(0, 0, 0, 10)).toBe(false);

    expect(hasVerticalClearance(0, 16, 4)).toBe(true);
    expect(hasVerticalClearance(0, 15, 5)).toBe(false);

    expect(canStepDeltaZ(10, 12)).toBe(true);
    expect(canStepDeltaZ(10, 13)).toBe(false);
    expect(canStepDeltaZ(10, 0)).toBe(true);
  });

  it("satisfies distance symmetry, triangle inequality, and isometric round-trip over random points", () => {
    let s = 0x9e3779b9;
    const next = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s;
    };

    for (let i = 0; i < 1000; i += 1) {
      const a = createPoint3D(next() % 7168, next() % 4096, (next() % 256) - 128);
      const b = createPoint3D(next() % 7168, next() % 4096, (next() % 256) - 128);
      const c = createPoint3D(next() % 7168, next() % 4096, (next() % 256) - 128);

      expect(chebyshevDistance(a, b)).toBe(chebyshevDistance(b, a));
      expect(chebyshevDistance(a, c)).toBeLessThanOrEqual(
        chebyshevDistance(a, b) + chebyshevDistance(b, c),
      );
      expect(manhattanDistance(a, b)).toBe(manhattanDistance(b, a));
      expect(manhattanDistance(a, c)).toBeLessThanOrEqual(
        manhattanDistance(a, b) + manhattanDistance(b, c),
      );

      expect(isoScreenToWorld(worldToIsoScreen(a), a.z)).toEqual({ x: a.x, y: a.y });
    }
  });
});
