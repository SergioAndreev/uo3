import { rotate, type Direction } from './direction.js';
import { HEIGHT_STEP_M, type Position } from './position.js';

/** Поворот ортографической камеры с шагом 90° по часовой стрелке. */
export type CameraRotation = 0 | 1 | 2 | 3;

/** Экранное направление: 0 — вверх экрана. */
export const toScreenDirection = (world: Direction, rotation: CameraRotation): Direction =>
  rotate(world, -2 * rotation);
export const toWorldDirection = (screen: Direction, rotation: CameraRotation): Direction =>
  rotate(screen, 2 * rotation);

/** Метры сцены: центр клетки, ось Y вверх. */
export const toScene = (p: Position): { x: number; y: number; z: number } => ({
  x: p.x + 0.5,
  y: p.h * HEIGHT_STEP_M,
  z: p.y + 0.5,
});
