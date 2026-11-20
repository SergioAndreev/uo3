import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import { resolveFacetDefinition, type FacetDefinition, type FacetId } from "./facet.js";
import { assertValidXY, type Point2D } from "./point.js";

export const SECTOR_SIZE = 16;
export const MAP_BLOCK_SIZE = 8;

export interface SectorCoord {
  readonly sectorX: number;
  readonly sectorY: number;
}

export interface SectorGridDimensions {
  readonly width: number;
  readonly height: number;
  readonly total: number;
}

export interface MapBlockCoord {
  readonly blockX: number;
  readonly blockY: number;
}

export interface MapBlockGridDimensions {
  readonly width: number;
  readonly height: number;
  readonly total: number;
}

export function toSectorCoord(point: Point2D): SectorCoord {
  const x = assertValidXY(point.x, "x");
  const y = assertValidXY(point.y, "y");
  return Object.freeze({
    sectorX: Math.floor(x / SECTOR_SIZE),
    sectorY: Math.floor(y / SECTOR_SIZE),
  });
}

export function getFacetSectorGrid(
  facet: FacetId | number | FacetDefinition,
): SectorGridDimensions {
  const def = resolveFacetDefinition(facet);
  const width = Math.ceil(def.width / SECTOR_SIZE);
  const height = Math.ceil(def.height / SECTOR_SIZE);
  return Object.freeze({ width, height, total: width * height });
}

export function packSectorKey(sectorX: number, sectorY: number): number {
  if (
    !Number.isInteger(sectorX) ||
    !Number.isInteger(sectorY) ||
    sectorX < 0 ||
    sectorX > 0xffff ||
    sectorY < 0 ||
    sectorY > 0xffff
  ) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_COORDINATE,
      `Sector coordinates must be uint16 integers, received (${String(sectorX)}, ${String(sectorY)})`,
      { details: { sectorX, sectorY } },
    );
  }
  return (((sectorY & 0xffff) << 16) | (sectorX & 0xffff)) >>> 0;
}

export function unpackSectorKey(key: number): SectorCoord {
  if (!Number.isInteger(key) || key < 0 || key > 0xffffffff) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_COORDINATE,
      `Sector key must be uint32, received ${String(key)}`,
      { details: { key } },
    );
  }
  return Object.freeze({
    sectorX: key & 0xffff,
    sectorY: (key >>> 16) & 0xffff,
  });
}

export function getCoveringSectors(
  point: Point2D,
  radius: number,
  facet: FacetId | number | FacetDefinition,
): readonly SectorCoord[] {
  const def = resolveFacetDefinition(facet);
  assertValidXY(point.x, "x");
  assertValidXY(point.y, "y");
  if (!Number.isInteger(radius) || radius < 0) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_RANGE,
      `Radius must be a non-negative integer, received ${String(radius)}`,
      { details: { radius } },
    );
  }

  const minX = Math.max(0, point.x - radius);
  const maxX = Math.min(def.width - 1, point.x + radius);
  const minY = Math.max(0, point.y - radius);
  const maxY = Math.min(def.height - 1, point.y + radius);

  const minSx = Math.floor(minX / SECTOR_SIZE);
  const maxSx = Math.floor(maxX / SECTOR_SIZE);
  const minSy = Math.floor(minY / SECTOR_SIZE);
  const maxSy = Math.floor(maxY / SECTOR_SIZE);

  const result: SectorCoord[] = [];
  for (let sy = minSy; sy <= maxSy; sy += 1) {
    for (let sx = minSx; sx <= maxSx; sx += 1) {
      result.push(Object.freeze({ sectorX: sx, sectorY: sy }));
    }
  }
  return result;
}

export function toMapBlockCoord(point: Point2D): MapBlockCoord {
  const x = assertValidXY(point.x, "x");
  const y = assertValidXY(point.y, "y");
  return Object.freeze({
    blockX: Math.floor(x / MAP_BLOCK_SIZE),
    blockY: Math.floor(y / MAP_BLOCK_SIZE),
  });
}

export function toBlockCellIndex(point: Point2D): number {
  const x = assertValidXY(point.x, "x");
  const y = assertValidXY(point.y, "y");
  return (y % MAP_BLOCK_SIZE) * MAP_BLOCK_SIZE + (x % MAP_BLOCK_SIZE);
}

export function getFacetMapBlockGrid(
  facet: FacetId | number | FacetDefinition,
): MapBlockGridDimensions {
  const def = resolveFacetDefinition(facet);
  const width = Math.ceil(def.width / MAP_BLOCK_SIZE);
  const height = Math.ceil(def.height / MAP_BLOCK_SIZE);
  return Object.freeze({ width, height, total: width * height });
}
