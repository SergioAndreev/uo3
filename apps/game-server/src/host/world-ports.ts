import type { RealmStore } from '@duskmarch/asset-formats';

/** Ближайшая по спирали точка, где герой ростом `height` может стоять; `null` — исходная допустима. */
export function spawnResolver(store: RealmStore, height: number, maxRadius = 32) {
  return (x: number, y: number, h: number): { x: number; y: number; h: number } | null => {
    if (store.canPlace(x, y, h, { height })) return null;
    for (let r = 0; r <= maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          for (const surface of store.surfaces(x + dx, y + dy)) {
            if (store.canPlace(x + dx, y + dy, surface, { height }))
              return { x: x + dx, y: y + dy, h: surface };
          }
        }
      }
    }
    return null;
  };
}

/** Безопасные зоны — клетки ориентиров `shelter` и `safe-*` пакета мира. */
export function safeZones(
  landmarks: Readonly<Record<string, readonly { x: number; y: number }[]>> | undefined,
) {
  const cells = new Set<string>();
  for (const [name, points] of Object.entries(landmarks ?? {})) {
    if (name === 'shelter' || name.startsWith('safe-'))
      for (const p of points) cells.add(`${p.x},${p.y}`);
  }
  return (x: number, y: number): boolean => cells.has(`${x},${y}`);
}
