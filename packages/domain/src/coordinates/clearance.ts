import { assertValidZ } from "./point.js";

export const PERSON_HEIGHT = 16;
export const STEP_HEIGHT = 2;

export function verticalIntervalsOverlap(
  zA: number,
  heightA: number,
  zB: number,
  heightB: number,
): boolean {
  if (heightA <= 0 || heightB <= 0) {
    return false;
  }
  return zA < zB + heightB && zB < zA + heightA;
}

export function hasVerticalClearance(
  floorZ: number,
  obstacleBottomZ: number,
  obstacleHeight = 1,
  actorHeight = PERSON_HEIGHT,
): boolean {
  assertValidZ(floorZ);
  return !verticalIntervalsOverlap(floorZ, actorHeight, obstacleBottomZ, obstacleHeight);
}

export function canStepDeltaZ(fromZ: number, toZ: number, maxStepHeight = STEP_HEIGHT): boolean {
  assertValidZ(fromZ);
  assertValidZ(toZ);
  return toZ - fromZ <= maxStepHeight;
}
