import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import {
  asFacetId,
  FACET_ALIGNMENT_TILES,
  resolveFacetDefinition,
  type FacetDefinition,
  type FacetId,
} from "./facet.js";

export const COORD_XY_MIN = 0;
export const COORD_XY_MAX = 65535;
export const Z_MIN = -128;
export const Z_MAX = 127;

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface Point3D extends Point2D {
  readonly z: number;
}

export interface Rect2D {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WorldLocation extends Point3D {
  readonly facet: FacetId;
}

export function assertValidXY(value: unknown, axis: "x" | "y"): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < COORD_XY_MIN ||
    value > COORD_XY_MAX
  ) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_COORDINATE,
      `Coordinate ${axis} must be an integer in [${String(COORD_XY_MIN)}, ${String(COORD_XY_MAX)}], received ${String(value)}`,
      { fieldPath: axis, details: { axis, received: value } },
    );
  }
  return value;
}

export function assertValidZ(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < Z_MIN || value > Z_MAX) {
    throw new DomainError(
      DomainErrorCode.ERR_Z_OUT_OF_RANGE,
      `Altitude z must be an integer in [${String(Z_MIN)}, ${String(Z_MAX)}], received ${String(value)}`,
      { fieldPath: "z", details: { received: value, min: Z_MIN, max: Z_MAX } },
    );
  }
  return value;
}

export function createPoint2D(x: number, y: number): Point2D {
  return Object.freeze({ x: assertValidXY(x, "x"), y: assertValidXY(y, "y") });
}

export function createPoint3D(x: number, y: number, z: number): Point3D {
  return Object.freeze({
    x: assertValidXY(x, "x"),
    y: assertValidXY(y, "y"),
    z: assertValidZ(z),
  });
}

export function offsetPoint3D(point: Point3D, dx: number, dy: number, dz = 0): Point3D {
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_COORDINATE,
      `Offset (dx, dy) must be integers, received (${String(dx)}, ${String(dy)})`,
      { details: { dx, dy } },
    );
  }
  if (!Number.isInteger(dz)) {
    throw new DomainError(
      DomainErrorCode.ERR_Z_OUT_OF_RANGE,
      `Offset dz must be an integer, received ${String(dz)}`,
      { details: { dz } },
    );
  }
  return createPoint3D(point.x + dx, point.y + dy, point.z + dz);
}

export function assertInFacetBounds(
  point: Point2D | Point3D,
  facet: FacetId | number | FacetDefinition,
): void {
  const def = resolveFacetDefinition(facet);
  assertValidXY(point.x, "x");
  assertValidXY(point.y, "y");
  if ("z" in point) {
    assertValidZ(point.z);
  }
  if (point.x < 0 || point.x >= def.width || point.y < 0 || point.y >= def.height) {
    throw new DomainError(
      DomainErrorCode.ERR_OUT_OF_MAP_BOUNDS,
      `Point (${String(point.x)}, ${String(point.y)}) is outside facet ${def.name} (${String(def.width)}×${String(def.height)})`,
      {
        details: { x: point.x, y: point.y, facetId: def.id, width: def.width, height: def.height },
      },
    );
  }
}

export function createWorldLocation(
  facet: FacetId | number,
  x: number,
  y: number,
  z: number,
): WorldLocation {
  const facetId = asFacetId(facet, "facet");
  const pt = createPoint3D(x, y, z);
  assertInFacetBounds(pt, facetId);
  return Object.freeze({ facet: facetId, x: pt.x, y: pt.y, z: pt.z });
}

export function createRect2D(x: number, y: number, width: number, height: number): Rect2D {
  const vx = assertValidXY(x, "x");
  const vy = assertValidXY(y, "y");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_COORDINATE,
      `Rect2D dimensions must be non-negative integers, received ${String(width)}×${String(height)}`,
      { details: { width, height } },
    );
  }
  return Object.freeze({ x: vx, y: vy, width, height });
}

export function rectContains(rect: Rect2D, point: Point2D): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

export function rectIntersects(a: Rect2D, b: Rect2D): boolean {
  if (a.width === 0 || a.height === 0 || b.width === 0 || b.height === 0) {
    return false;
  }
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function rectClampToFacet(rect: Rect2D, facet: FacetId | number | FacetDefinition): Rect2D {
  const def = resolveFacetDefinition(facet);
  const minX = Math.max(0, Math.min(rect.x, def.width));
  const minY = Math.max(0, Math.min(rect.y, def.height));
  const maxX = Math.max(minX, Math.min(rect.x + rect.width, def.width));
  const maxY = Math.max(minY, Math.min(rect.y + rect.height, def.height));
  return createRect2D(minX, minY, maxX - minX, maxY - minY);
}

export function validatePartitionBounds(
  rect: Rect2D,
  facet: FacetId | number | FacetDefinition,
): void {
  const def = resolveFacetDefinition(facet);
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x % FACET_ALIGNMENT_TILES !== 0 ||
    rect.y % FACET_ALIGNMENT_TILES !== 0 ||
    rect.width % FACET_ALIGNMENT_TILES !== 0 ||
    rect.height % FACET_ALIGNMENT_TILES !== 0
  ) {
    throw new DomainError(
      DomainErrorCode.ERR_UNALIGNED_PARTITION_BOUNDS,
      `Partition bounds (${String(rect.x)}, ${String(rect.y)}, ${String(rect.width)}, ${String(rect.height)}) must be positive multiples of ${String(FACET_ALIGNMENT_TILES)} tiles`,
      { details: { rect } },
    );
  }
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > def.width ||
    rect.y + rect.height > def.height
  ) {
    throw new DomainError(
      DomainErrorCode.ERR_OUT_OF_MAP_BOUNDS,
      `Partition bounds exceed facet ${def.name} (${String(def.width)}×${String(def.height)})`,
      { details: { rect, facetId: def.id, width: def.width, height: def.height } },
    );
  }
}

export const POINT3D_BYTE_LENGTH = 5;
export const WORLD_LOCATION_BYTE_LENGTH = 6;

function assertByteLength(bytes: Uint8Array, offset: number, required: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset + required > bytes.byteLength) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_COORDINATE,
      `Buffer too short for ${String(required)}-byte coordinate at offset ${String(offset)} (length=${String(bytes.byteLength)})`,
      { details: { byteLength: bytes.byteLength, offset, required } },
    );
  }
}

export function writePoint3D(
  point: Point3D,
  target: Uint8Array = new Uint8Array(POINT3D_BYTE_LENGTH),
  offset = 0,
): Uint8Array {
  const validated = createPoint3D(point.x, point.y, point.z);
  assertByteLength(target, offset, POINT3D_BYTE_LENGTH);
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
  view.setUint16(offset, validated.x, false);
  view.setUint16(offset + 2, validated.y, false);
  view.setInt8(offset + 4, validated.z);
  return target;
}

export function readPoint3D(bytes: Uint8Array, offset = 0): Point3D {
  assertByteLength(bytes, offset, POINT3D_BYTE_LENGTH);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return createPoint3D(
    view.getUint16(offset, false),
    view.getUint16(offset + 2, false),
    view.getInt8(offset + 4),
  );
}

export function writeWorldLocation(
  location: WorldLocation,
  target: Uint8Array = new Uint8Array(WORLD_LOCATION_BYTE_LENGTH),
  offset = 0,
): Uint8Array {
  const validated = createWorldLocation(location.facet, location.x, location.y, location.z);
  assertByteLength(target, offset, WORLD_LOCATION_BYTE_LENGTH);
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
  view.setUint8(offset, validated.facet);
  view.setUint16(offset + 1, validated.x, false);
  view.setUint16(offset + 3, validated.y, false);
  view.setInt8(offset + 5, validated.z);
  return target;
}

export function readWorldLocation(bytes: Uint8Array, offset = 0): WorldLocation {
  assertByteLength(bytes, offset, WORLD_LOCATION_BYTE_LENGTH);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const facet = view.getUint8(offset);
  const x = view.getUint16(offset + 1, false);
  const y = view.getUint16(offset + 3, false);
  const z = view.getInt8(offset + 5);
  return createWorldLocation(facet, x, y, z);
}
