import type { Cell } from './position.js';
import type { Realm } from './realms.js';

export const SECTOR_SIZE = 16;
export const CHUNK_SIZE = 32;

export interface GridKey {
  readonly gx: number;
  readonly gy: number;
}

const keyOf =
  (size: number) =>
  ({ x, y }: Cell): GridKey => ({ gx: Math.floor(x / size), gy: Math.floor(y / size) });
export const sectorOf = keyOf(SECTOR_SIZE);
export const chunkOf = keyOf(CHUNK_SIZE);

/** Первая и последняя клетки ячейки сетки. */
export const gridBounds = ({ gx, gy }: GridKey, size: number): { min: Cell; max: Cell } => ({
  min: { x: gx * size, y: gy * size },
  max: { x: gx * size + size - 1, y: gy * size + size - 1 },
});

/** Сектора, пересекаемые квадратом радиуса `radius` по Чебышёву, обрезанные границей плана. */
export function sectorsInRange(realm: Realm, center: Cell, radius: number): GridKey[] {
  const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max - 1);
  const from = sectorOf({
    x: clamp(center.x - radius, realm.width),
    y: clamp(center.y - radius, realm.height),
  });
  const to = sectorOf({
    x: clamp(center.x + radius, realm.width),
    y: clamp(center.y + radius, realm.height),
  });
  const keys: GridKey[] = [];
  for (let gy = from.gy; gy <= to.gy; gy++)
    for (let gx = from.gx; gx <= to.gx; gx++) keys.push({ gx, gy });
  return keys;
}
