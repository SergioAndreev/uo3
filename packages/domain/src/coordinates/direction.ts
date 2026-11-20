import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import { createPoint2D, createPoint3D, type Point2D, type Point3D } from "./point.js";

export const Direction = {
  North: 0,
  Right: 1,
  East: 2,
  Down: 3,
  South: 4,
  Left: 5,
  West: 6,
  Up: 7,
} as const;

export type Direction = (typeof Direction)[keyof typeof Direction];

export const DIRECTION_MASK = 0x07;
export const DIRECTION_RUNNING_BIT = 0x80;
export const DIRECTION_RESERVED_MASK = 0x78;

export interface DirectionOffset {
  readonly dx: -1 | 0 | 1;
  readonly dy: -1 | 0 | 1;
}

export const DIRECTION_OFFSETS: Readonly<Record<Direction, DirectionOffset>> = Object.freeze({
  [Direction.North]: Object.freeze({ dx: 0, dy: -1 }),
  [Direction.Right]: Object.freeze({ dx: 1, dy: -1 }),
  [Direction.East]: Object.freeze({ dx: 1, dy: 0 }),
  [Direction.Down]: Object.freeze({ dx: 1, dy: 1 }),
  [Direction.South]: Object.freeze({ dx: 0, dy: 1 }),
  [Direction.Left]: Object.freeze({ dx: -1, dy: 1 }),
  [Direction.West]: Object.freeze({ dx: -1, dy: 0 }),
  [Direction.Up]: Object.freeze({ dx: -1, dy: -1 }),
});

export interface DecodedDirection {
  readonly direction: Direction;
  readonly running: boolean;
}

export function asDirection(value: number): Direction {
  if (!Number.isInteger(value) || value < 0 || value > 7) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_DIRECTION,
      `Base direction must be an integer in [0, 7], received ${String(value)}`,
      { fieldPath: "direction", details: { received: value } },
    );
  }
  return value as Direction;
}

export function encodeDirection(direction: Direction, running = false): number {
  const base = asDirection(direction);
  return running ? base | DIRECTION_RUNNING_BIT : base;
}

export function decodeDirection(byte: number): DecodedDirection {
  if (!Number.isInteger(byte) || byte < 0 || byte > 255 || (byte & DIRECTION_RESERVED_MASK) !== 0) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_DIRECTION,
      `Invalid direction byte: ${String(byte)} (reserved bits 0x78 must be 0)`,
      { fieldPath: "direction", details: { received: byte } },
    );
  }
  return Object.freeze({
    direction: (byte & DIRECTION_MASK) as Direction,
    running: (byte & DIRECTION_RUNNING_BIT) !== 0,
  });
}

export function writeDirectionByte(
  direction: Direction,
  running = false,
  target: Uint8Array = new Uint8Array(1),
  offset = 0,
): Uint8Array {
  if (!Number.isInteger(offset) || offset < 0 || offset >= target.byteLength) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_DIRECTION,
      `Buffer too short for 1-byte direction at offset ${String(offset)}`,
    );
  }
  target[offset] = encodeDirection(direction, running);
  return target;
}

export function readDirectionByte(bytes: Uint8Array, offset = 0): DecodedDirection {
  if (!Number.isInteger(offset) || offset < 0 || offset >= bytes.byteLength) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_DIRECTION,
      `Buffer too short for 1-byte direction at offset ${String(offset)}`,
    );
  }
  return decodeDirection(bytes[offset]!);
}

export function stepPoint(point: Point3D, direction: Direction): Point3D;
export function stepPoint(point: Point2D, direction: Direction): Point2D;
export function stepPoint(point: Point2D | Point3D, direction: Direction): Point2D | Point3D {
  const offset = DIRECTION_OFFSETS[asDirection(direction)];
  if ("z" in point) {
    return createPoint3D(point.x + offset.dx, point.y + offset.dy, point.z);
  }
  return createPoint2D(point.x + offset.dx, point.y + offset.dy);
}

export function rotateDirection(direction: Direction, deltaSteps: number): Direction {
  const base = asDirection(direction);
  if (!Number.isInteger(deltaSteps)) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_DIRECTION,
      `Rotation delta must be an integer, received ${String(deltaSteps)}`,
    );
  }
  return ((((base + deltaSteps) % 8) + 8) % 8) as Direction;
}

export function reverseDirection(direction: Direction): Direction {
  return ((asDirection(direction) + 4) & 0x07) as Direction;
}

export function getDirectionBetween(
  from: Point2D,
  to: Point2D,
  fallback: Direction = Direction.North,
): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) {
    return asDirection(fallback);
  }
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);

  if (ax > 2 * ay) {
    return dx > 0 ? Direction.East : Direction.West;
  }
  if (ay > 2 * ax) {
    return dy > 0 ? Direction.South : Direction.North;
  }
  if (dx > 0) {
    return dy > 0 ? Direction.Down : Direction.Right;
  }
  return dy > 0 ? Direction.Left : Direction.Up;
}
