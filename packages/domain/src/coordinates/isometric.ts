import type { Point2D, Point3D } from "./point.js";

export const TILE_WIDTH_PX = 44;
export const TILE_HEIGHT_PX = 44;
export const TILE_HALF_PX = 22;
export const Z_STEP_PX = 4;

export interface IsoScreenPoint {
  readonly screenX: number;
  readonly screenY: number;
}

export function worldToIsoScreen(point: Point3D): IsoScreenPoint {
  return Object.freeze({
    screenX: (point.x - point.y) * TILE_HALF_PX,
    screenY: (point.x + point.y) * TILE_HALF_PX - point.z * Z_STEP_PX,
  });
}

export function isoScreenToWorld(screen: IsoScreenPoint, z = 0): Point2D {
  const syAdj = screen.screenY + z * Z_STEP_PX;
  return Object.freeze({
    x: Math.floor((syAdj + screen.screenX) / TILE_WIDTH_PX),
    y: Math.floor((syAdj - screen.screenX) / TILE_HEIGHT_PX),
  });
}

export function computeBaseDrawDepth(point: Point2D): number {
  return point.x + point.y;
}
