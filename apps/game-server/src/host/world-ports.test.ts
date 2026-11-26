import { RealmStore, SYNTHETIC_CATALOG, generateSyntheticPack } from '@duskmarch/asset-formats';
import { expect, it } from 'vitest';
import { safeZones, spawnResolver } from './world-ports.js';

it('точка появления: допустимая — null, в колонне — ближайшая свободная; безопасные зоны', () => {
  const pack = generateSyntheticPack('proving', 42);
  const store = RealmStore.fromPack(pack.manifest, (p) => pack.files.get(p), SYNTHETIC_CATALOG);
  const resolve = spawnResolver(store, 7);
  expect(resolve(32, 32, 0)).toBeNull();
  const fixed = resolve(30, 30, 0);
  expect(fixed).not.toBeNull();
  expect(Math.max(Math.abs((fixed?.x ?? 0) - 30), Math.abs((fixed?.y ?? 0) - 30))).toBe(1);
  expect(spawnResolver(store, 7, 0)(30, 30, 0)).toBeNull();
  const safe = safeZones(pack.world.landmarks);
  expect(safe(9, 41)).toBe(true);
  expect(safe(32, 32)).toBe(false);
  expect(safeZones({ 'safe-inn': [{ x: 1, y: 2 }], door: [{ x: 3, y: 3 }] })(1, 2)).toBe(true);
  expect(safeZones(undefined)(1, 1)).toBe(false);
});
