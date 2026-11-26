import { CELL_FLAGS, SURFACES, hasFlag, sha256, type CellFlags } from '@duskmarch/domain';
import { expect, it } from 'vitest';
import { decodeChunk, readCell, toLocal } from '../chunk/index.js';
import { packFingerprint, validateManifest, verifyContents } from '../pack/index.js';
import { validateWorldIndex } from '../world/index.js';
import { MAX_LAND_STEP, generateSyntheticPack, limitSlopes } from './index.js';

const proving = generateSyntheticPack('proving', 42);

const decoded = new WeakMap<object, Map<string, ReturnType<typeof decodeChunk>>>();
const cellAt = (pack: typeof proving, x: number, y: number) => {
  const { cx, cy, lx, ly } = toLocal({ x, y });
  let cache = decoded.get(pack);
  if (!cache) {
    cache = new Map();
    for (const c of pack.world.chunks) {
      const path = pack.manifest.entries.find((e) => e.key === c.key)?.path ?? '';
      cache.set(`${c.cx},${c.cy}`, decodeChunk(pack.files.get(path) ?? new Uint8Array()));
    }
    decoded.set(pack, cache);
  }
  const chunk = cache.get(`${cx},${cy}`) ?? decodeChunk(new Uint8Array());
  return {
    ...readCell(chunk, lx, ly),
    objects: chunk.objects.filter((o) => o.lx === lx && o.ly === ly),
  };
};
const flag = (flags: number, name: (typeof CELL_FLAGS)[number]) =>
  hasFlag(flags as CellFlags, name);
const surface = (i: number) => SURFACES[i];

it('повтор генерации побайтно совпадает', () => {
  const again = generateSyntheticPack('proving', 42);
  expect([...again.files.keys()]).toEqual([...proving.files.keys()]);
  for (const [path, bytes] of proving.files)
    expect(sha256(again.files.get(path) ?? new Uint8Array()), path).toBe(sha256(bytes));
  expect(packFingerprint(again.manifest)).toBe(packFingerprint(proving.manifest));
});

it('пакет proving проходит проверку без ошибок и предупреждений', async () => {
  expect(validateManifest(proving.manifest)).toEqual([]);
  const listed = [...proving.files.keys()].filter((p) => p !== 'pack.json');
  expect(await verifyContents(proving.manifest, async (p) => proving.files.get(p), listed)).toEqual(
    [],
  );
  expect(validateWorldIndex(proving.world)).toEqual([]);
  expect(proving.world).toMatchObject({ width: 64, height: 64, realm: { key: 'proving' } });
  expect(proving.world.chunks).toHaveLength(4);
  expect(new Set(proving.manifest.entries.map((e) => e.license))).toEqual(
    new Set(['synthetic-generated']),
  );
});

it('ориентиры соответствуют клеткам', () => {
  const lm = proving.world.landmarks ?? {};
  for (const points of Object.values(lm))
    for (const { x, y } of points) expect(x < 64 && y < 64).toBe(true);
  expect(lm['stairs']?.map(({ x, y }) => cellAt(proving, x, y).h)).toEqual([0, 2, 4, 6, 8]);
  for (const { x, y } of lm['low-ceiling'] ?? []) {
    const c = cellAt(proving, x, y);
    expect(c.h).toBe(0);
    expect(c.objects.some((o) => o.h === 6 && flag(o.flags, 'roof'))).toBe(true);
  }
  for (const { x, y } of lm['wall-window'] ?? []) {
    const c = cellAt(proving, x, y);
    expect(flag(c.flags, 'impassable') && flag(c.flags, 'blocks-sight')).toBe(true);
  }
  const opening = lm['wall-opening']?.[0] ?? { x: 0, y: 0 };
  expect(flag(cellAt(proving, opening.x, opening.y).flags, 'blocks-sight')).toBe(false);
  const door = lm['door']?.[0] ?? { x: 0, y: 0 };
  expect(flag(cellAt(proving, door.x, door.y).flags, 'door')).toBe(true);
  const check = (name: string, s: string, ...flags: (typeof CELL_FLAGS)[number][]) => {
    for (const { x, y } of lm[name] ?? []) {
      const c = cellAt(proving, x, y);
      expect(surface(c.surface), name).toBe(s);
      for (const f of flags) expect(flag(c.flags, f), `${name} ${f}`).toBe(true);
    }
  };
  check('shallow-water', 'shallow-water', 'water', 'standable');
  check('deep-water', 'deep-water', 'water', 'deep');
  check('shelter', 'stone', 'shelter');
  check('hazard', 'ash', 'hazard');
  check('spawn', 'grass', 'standable');
  for (const { x, y } of lm['deep-water'] ?? [])
    expect(flag(cellAt(proving, x, y).flags, 'standable')).toBe(false);
});

it('пресет field: сиды различаются, перепады суши не больше 2', async () => {
  const a = generateSyntheticPack('field', 42);
  const b = generateSyntheticPack('field', 1337);
  expect(a.world.chunks).toHaveLength(64);
  expect(a.world.chunks.some((c, i) => c.sha256 !== b.world.chunks[i]?.sha256)).toBe(true);
  expect(a.world.landmarks).toEqual(b.world.landmarks);
  expect(validateManifest(a.manifest)).toEqual([]);
  expect(await verifyContents(a.manifest, async (p) => a.files.get(p))).toEqual([]);
  const size = 256;
  const heights = new Int16Array(size * size);
  const water = new Uint8Array(size * size);
  const trees = { count: 0 };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = cellAt(a, x, y);
      heights[y * size + x] = c.h;
      water[y * size + x] = flag(c.flags, 'water') ? 1 : 0;
      trees.count += c.objects.filter((o) => o.key === 'model.test-tree').length;
    }
  }
  expect(trees.count).toBeGreaterThan(0);
  const kinds = new Set<number>();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      kinds.add(cellAt(a, x, y).surface);
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= size || ny < 0 || ny >= size) continue;
        if (water[y * size + x] || water[ny * size + nx]) continue;
        expect(
          Math.abs((heights[y * size + x] ?? 0) - (heights[ny * size + nx] ?? 0)),
        ).toBeLessThanOrEqual(MAX_LAND_STEP);
      }
    }
  }
  expect(kinds.size).toBeGreaterThanOrEqual(4);
}, 120_000);

it('ограничение склонов', () => {
  const h = new Int16Array([0, 10, 10, 10]);
  limitSlopes(h, 2, 2);
  expect([...h]).toEqual([0, 2, 2, 2]);
});
