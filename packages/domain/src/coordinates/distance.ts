import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import type { Point2D, Point3D, WorldLocation } from "./point.js";

export function chebyshevDistance(a: Point2D, b: Point2D): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function manhattanDistance(a: Point2D, b: Point2D): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function euclideanDistanceSquared(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function euclideanDistance(a: Point2D, b: Point2D): number {
  return Math.sqrt(euclideanDistanceSquared(a, b));
}

export function verticalDistance(a: Point3D, b: Point3D): number {
  return Math.abs(a.z - b.z);
}

export function isInRange(
  a: Point2D | WorldLocation,
  b: Point2D | WorldLocation,
  range: number,
): boolean {
  if ("facet" in a && "facet" in b && a.facet !== b.facet) {
    return false;
  }
  return chebyshevDistance(a, b) <= range;
}

export interface WorldDistanceMetrics {
  readonly chebyshev: number;
  readonly manhattan: number;
  readonly euclideanSquared: number;
  readonly euclidean: number;
  readonly vertical: number;
}

export function worldLocationDistance(a: WorldLocation, b: WorldLocation): WorldDistanceMetrics {
  if (a.facet !== b.facet) {
    throw new DomainError(
      DomainErrorCode.ERR_FACET_MISMATCH,
      `Cannot compute distance across different facets (${String(a.facet)} vs ${String(b.facet)})`,
      { details: { facetA: a.facet, facetB: b.facet } },
    );
  }
  const euclideanSquared = euclideanDistanceSquared(a, b);
  return Object.freeze({
    chebyshev: chebyshevDistance(a, b),
    manhattan: manhattanDistance(a, b),
    euclideanSquared,
    euclidean: Math.sqrt(euclideanSquared),
    vertical: verticalDistance(a, b),
  });
}
