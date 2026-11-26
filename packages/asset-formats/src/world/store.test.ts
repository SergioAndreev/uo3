import { SeededRng, flagBit, type Direction } from '@duskmarch/domain';
import { beforeEach, expect, it } from 'vitest';
import { generateSyntheticPack } from '../synthetic/index.js';
import {
  RealmStore,
  SYNTHETIC_CATALOG,
  WorldError,
  applyPatch,
  lineOfSight,
  type WorldPatch,
} from './index.js';

const pack = generateSyntheticPack('proving', 42);
const files = () => {
  const paths = new Map(pack.manifest.entries.map((e) => [e.key, e.path]));
  return new Map(
    pack.world.chunks.map((c) => [
      c.key,
      pack.files.get(paths.get(c.key) ?? '') ?? new Uint8Array(),
    ]),
  );
};
const lm = pack.world.landmarks ?? {};
const at = (name: string, i = 0) => lm[name]?.[i] ?? { x: 0, y: 0 };
let store: RealmStore;
beforeEach(() => {
  store = RealmStore.load(pack.world, files(), SYNTHETIC_CATALOG);
});
const hero = { height: 7, climb: 2 };
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as WorldError).code;
  }
  return 'ok';
};

it('загрузка плана и подменённый чанк', () => {
  expect(store.realm).toEqual({ id: 255, key: 'proving' });
  expect([store.width, store.height, store.cols * store.rows]).toEqual([64, 64, 4]);
  const broken = files();
  const key = pack.world.chunks[0]?.key ?? '';
  broken.set(key, new Uint8Array([1, 2, 3]));
  expect(code(() => RealmStore.load(pack.world, broken, SYNTHETIC_CATALOG))).toBe(
    'WORLD_CHUNK_HASH',
  );
  const missing = files();
  missing.delete(key);
  expect(code(() => RealmStore.load(pack.world, missing, SYNTHETIC_CATALOG))).toBe(
    'WORLD_CHUNK_MISSING',
  );
});

it('неизвестная модель', () => {
  const catalog = new Map(SYNTHETIC_CATALOG);
  catalog.delete('model.test-wall');
  let error: unknown;
  try {
    RealmStore.load(pack.world, files(), catalog);
  } catch (e) {
    error = e;
  }
  expect(error).toMatchObject({
    code: 'WORLD_UNKNOWN_OBJECT',
    details: { key: 'model.test-wall', x: 20 },
  });
});

it('опоры и потолок', () => {
  const low = at('low-ceiling');
  expect(store.surfaces(low.x, low.y)).toEqual([0, 9]);
  expect(store.ceiling(low.x, low.y, 0)).toBe(6);
  expect(store.ceiling(at('spawn').x, at('spawn').y, 0)).toBeUndefined();
  expect(store.surfaces(-1, 0)).toEqual([]);
  expect(store.surfaces(at('deep-water').x, at('deep-water').y)).toEqual([]);
  expect(store.cell(64, 0)).toBeUndefined();
});

it('размещение', () => {
  const low = at('low-ceiling');
  expect(store.canPlace(low.x, low.y, 0, { height: 7 })).toBe(false);
  expect(store.canPlace(low.x, low.y, 0, { height: 6 })).toBe(true);
  expect(store.canPlace(low.x, low.y, 9, { height: 7 })).toBe(true);
  expect(store.canPlace(at('deep-water').x, at('deep-water').y, -8, hero)).toBe(false);
  expect(store.canPlace(at('wall-window').x, at('wall-window').y, 0, hero)).toBe(false);
  expect(store.canPlace(at('spawn').x, at('spawn').y, 0, hero)).toBe(true);
  expect(store.canPlace(at('spawn').x, at('spawn').y, 1, hero)).toBe(false);
  expect(store.canPlace(30, 30, 0, hero)).toBe(false);
});

it('лестница и высокая ступень', () => {
  let pos = { x: 3, y: 4, h: 0 };
  const heights: number[] = [];
  for (let k = 0; k < 5; k++) {
    const r = store.step(pos, 2, hero);
    if (!r.ok) throw new Error(r.reason);
    heights.push(r.h);
    pos = r;
  }
  expect(heights).toEqual([0, 2, 4, 6, 8]);
  expect(store.step({ x: 4, y: 4, h: 0 }, 2, { height: 7, climb: 1 })).toEqual({
    ok: false,
    reason: 'too-high',
  });
  expect(store.step({ x: 8, y: 4, h: 8 }, 2, hero)).toEqual({ ok: true, x: 9, y: 4, h: 0 });
});

it('причины отказа шага', () => {
  expect(store.step({ x: 0, y: 0, h: 0 }, 0, hero)).toEqual({ ok: false, reason: 'out-of-realm' });
  expect(store.step({ x: 47, y: 4, h: -1 }, 2, hero)).toEqual({ ok: false, reason: 'no-surface' });
  expect(store.step({ x: 19, y: 5, h: 0 }, 2, hero)).toEqual({ ok: false, reason: 'no-surface' });
  const low = at('low-ceiling');
  // С пола 0 вершина ящика (9) недостижима, а пол под потолком 6 мал для роста 7.
  expect(store.step({ x: low.x - 1, y: low.y, h: 0 }, 2, hero)).toEqual({
    ok: false,
    reason: 'blocked',
  });
  expect(store.step({ x: low.x - 1, y: low.y, h: 0 }, 2, { height: 6, climb: 2 })).toMatchObject({
    ok: true,
    h: 0,
  });
  expect(store.step({ x: low.x - 1, y: low.y, h: 8 }, 2, hero)).toMatchObject({ ok: true, h: 9 });

  expect(store.step({ x: 31, y: 30, h: 0 }, 6, hero)).toEqual({ ok: false, reason: 'blocked' });
  // Диагональ мимо угла стены: (19,10) → (20,11), ортогональная (20,10) — стена.
  expect(store.step({ x: 19, y: 10, h: 0 }, 3 as Direction, hero)).toEqual({
    ok: false,
    reason: 'corner',
  });
  expect(store.step({ x: 19, y: 12, h: 0 }, 3 as Direction, hero)).toMatchObject({ ok: true });
});

it('линия видимости: поле, стена, проём, клетка цели', () => {
  expect(lineOfSight(store, { x: 30, y: 20, h: 0 }, { x: 36, y: 26, h: 0 }).visible).toBe(true);
  expect(lineOfSight(store, { x: 18, y: 4, h: 0 }, { x: 22, y: 4, h: 0 })).toMatchObject({
    visible: false,
    reason: 'cell',
    blockedAt: { x: 20, y: 4 },
  });
  expect(lineOfSight(store, { x: 18, y: 6, h: 0 }, { x: 22, y: 6, h: 0 }).visible).toBe(true);
  expect(lineOfSight(store, { x: 18, y: 4, h: 0 }, { x: 20, y: 4, h: 0 }).visible).toBe(true);
  expect(lineOfSight(store, { x: 20, y: 4, h: 0 }, { x: 18, y: 4, h: 0 }).visible).toBe(true);
});

it('дальность, план и трассировка', () => {
  expect(lineOfSight(store, { x: 0, y: 30, h: 0 }, { x: 21, y: 30, h: 0 })).toEqual({
    visible: false,
    reason: 'range',
  });
  expect(
    lineOfSight(store, { x: 0, y: 30, h: 0 }, { x: 21, y: 30, h: 0 }, { range: 24 }).visible,
  ).toBe(true);
  expect(lineOfSight(store, { x: 0, y: 0, h: 0, realm: 0 }, { x: 1, y: 1, h: 0 })).toEqual({
    visible: false,
    reason: 'realm',
  });
  const traced = lineOfSight(store, { x: 17, y: 4, h: 0 }, { x: 23, y: 4, h: 0 }, { trace: true });
  expect(traced.trace?.map((s) => s.x)).toEqual([18, 19, 20]);
  expect(traced).toMatchObject({ reason: 'cell', blockedAt: { x: 20, y: 4 } });
  expect(traced.trace?.[0]?.rayH).toBe(6);
});

it('рельеф и объекты закрывают луч по высоте', () => {
  // Глаза на высоте 1 у ступеней: ступень 8 выше луча.
  expect(
    lineOfSight(store, { x: 2, y: 4, h: 0 }, { x: 10, y: 4, h: 0 }, { fromEye: 1, toEye: 1 }),
  ).toMatchObject({
    visible: false,
    reason: 'terrain',
  });
  const base = store.version();
  applyPatch(store, {
    id: 'patch.screen',
    base,
    ops: [
      { op: 'add-object', key: 'model.test-wall', x: 33, y: 20, h: 0, flags: ['blocks-sight'] },
    ],
  });
  expect(lineOfSight(store, { x: 30, y: 20, h: 0 }, { x: 36, y: 20, h: 0 })).toMatchObject({
    reason: 'object',
  });
  expect(
    lineOfSight(store, { x: 30, y: 20, h: 13 }, { x: 36, y: 20, h: 13 }, { fromEye: 0, toEye: 0 })
      .visible,
  ).toBe(true);
});

it('сомкнутые углы', () => {
  const base = store.version();
  const wall = (x: number, y: number) => ({
    op: 'set-cell' as const,
    x,
    y,
    flags: ['impassable' as const, 'blocks-sight' as const],
  });
  applyPatch(store, { id: 'patch.gap', base, ops: [wall(33, 30), wall(32, 31)] });
  expect(lineOfSight(store, { x: 32, y: 30, h: 0 }, { x: 33, y: 31, h: 0 })).toMatchObject({
    visible: false,
    reason: 'corner',
  });
  expect(lineOfSight(store, { x: 30, y: 28, h: 0 }, { x: 35, y: 33, h: 0 })).toMatchObject({
    visible: false,
    reason: 'corner',
  });
  const one = RealmStore.load(pack.world, files(), SYNTHETIC_CATALOG);
  applyPatch(one, { id: 'patch.one', base: one.version(), ops: [wall(33, 30)] });
  expect(lineOfSight(one, { x: 32, y: 30, h: 0 }, { x: 33, y: 31, h: 0 }).visible).toBe(true);
});

it('симметрия на 1000 случайных пар', () => {
  const rng = new SeededRng('los-symmetry');
  let blocked = 0;
  for (let n = 0; n < 1000; n++) {
    const a = { x: rng.int(0, 63), y: rng.int(0, 63), h: 0 };
    const b = {
      x: rng.int(Math.max(0, a.x - 20), Math.min(63, a.x + 20)),
      y: rng.int(Math.max(0, a.y - 20), Math.min(63, a.y + 20)),
      h: 0,
    };
    a.h = store.cell(a.x, a.y)?.h ?? 0;
    b.h = store.cell(b.x, b.y)?.h ?? 0;
    const ab = lineOfSight(store, a, b).visible;
    expect(lineOfSight(store, b, a).visible, `${JSON.stringify(a)} ↔ ${JSON.stringify(b)}`).toBe(
      ab,
    );
    if (!ab) blocked++;
  }
  expect(blocked).toBeGreaterThan(10);
});

it('версия плана', () => {
  const again = RealmStore.load(pack.world, files(), SYNTHETIC_CATALOG);
  expect(again.version()).toBe(store.version());
  expect(store.version()).toMatch(/^[0-9a-f]{64}$/);
  expect(store.chunkHashes().map((c) => c.hash)).toEqual(pack.world.chunks.map((c) => c.sha256));
  const shuffled = { ...pack.world, chunks: [...pack.world.chunks].reverse() };
  expect(RealmStore.load(shuffled, files(), SYNTHETIC_CATALOG).version()).toBe(store.version());
});

it('операции, конфликты и атомарность', () => {
  const base = store.version();
  const bad: unknown = {
    id: 'p',
    base,
    ops: [
      { op: 'set-cell', x: 1, y: 1 },
      { op: 'set-cell', x: 1, y: 1, h: 2000 },
    ],
  };
  expect(() => applyPatch(store, bad)).toThrow(
    expect.objectContaining({ code: 'PATCH_INVALID', details: { op: 1 } }),
  );
  expect(code(() => applyPatch(store, { id: 'p', base, ops: [{ op: 'fly' }] }))).toBe(
    'PATCH_INVALID',
  );
  expect(
    code(() => applyPatch(store, { id: 'p', base, ops: [{ op: 'set-cell', x: 99, y: 1 }] })),
  ).toBe('PATCH_INVALID');
  expect(
    code(() =>
      applyPatch(store, {
        id: 'p',
        base,
        ops: [{ op: 'add-object', key: 'model.none', x: 1, y: 1, h: 0 }],
      }),
    ),
  ).toBe('PATCH_INVALID');
  const five: WorldPatch = {
    id: 'patch.five',
    base,
    ops: [
      { op: 'set-cell', x: 1, y: 1, h: 3 },
      { op: 'fill', x: 2, y: 2, width: 3, height: 3, surface: 'sand' },
      { op: 'remove-object', key: 'model.test-crate', x: 1, y: 1, h: 0 },
      { op: 'set-cell', x: 5, y: 5, h: 3 },
      { op: 'set-cell', x: 6, y: 6, h: 3 },
    ],
  };
  expect(code(() => applyPatch(store, five))).toBe('PATCH_CONFLICT');
  expect(store.version()).toBe(base);
  expect(store.cell(1, 1)?.h).toBe(0);
  const first = applyPatch(store, {
    id: 'patch.a',
    base,
    ops: [{ op: 'set-cell', x: 1, y: 1, h: 1 }],
  });
  expect(first.version).not.toBe(base);
  expect(
    code(() =>
      applyPatch(store, { id: 'patch.b', base, ops: [{ op: 'set-cell', x: 2, y: 1, h: 1 }] }),
    ),
  ).toBe('PATCH_BASE_MISMATCH');
  expect(
    code(() =>
      applyPatch(store, {
        id: 'patch.c',
        base: first.version,
        ops: [{ op: 'fill', x: 0, y: 0, width: 0, height: 1 }],
      }),
    ),
  ).toBe('PATCH_INVALID');
});

it('откат возвращает версию и байты', () => {
  const base = store.version();
  const before = new Map(store.chunkHashes().map((c) => [`${c.cx},${c.cy}`, c.hash]));
  const result = applyPatch(store, {
    id: 'patch.mixed',
    base,
    ops: [
      {
        op: 'fill',
        x: 30,
        y: 30,
        width: 4,
        height: 4,
        surface: 'sand',
        h: 1,
        flags: ['standable'],
        tint: 5,
      },
      { op: 'remove-object', key: 'model.test-column', x: 30, y: 30, h: 0 },
      {
        op: 'add-object',
        key: 'model.test-crate',
        x: 40,
        y: 40,
        h: 0,
        rotation: 2,
        flags: ['standable'],
      },
      { op: 'set-cell', x: 31, y: 33, flags: [] },
    ],
  });
  expect([...result.chunks.keys()].sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
  const restored = applyPatch(store, result.inverse);
  expect(restored.version).toBe(base);
  for (const c of store.chunkHashes()) expect(c.hash).toBe(before.get(`${c.cx},${c.cy}`));
});

it('запросы видят изменения', () => {
  const base = store.version();
  expect(store.step({ x: 32, y: 20, h: 0 }, 2, hero)).toMatchObject({ ok: true });
  applyPatch(store, {
    id: 'patch.wall',
    base,
    ops: [{ op: 'set-cell', x: 33, y: 20, flags: ['impassable', 'blocks-sight'] }],
  });
  expect(store.step({ x: 32, y: 20, h: 0 }, 2, hero)).toEqual({ ok: false, reason: 'no-surface' });
  expect(lineOfSight(store, { x: 30, y: 20, h: 0 }, { x: 36, y: 20, h: 0 })).toMatchObject({
    reason: 'cell',
  });
  expect(flagBit('impassable')).toBe(1);
});

it('загрузка из пакета через чтение по пути', () => {
  const loaded = RealmStore.fromPack(pack.manifest, (p) => pack.files.get(p), SYNTHETIC_CATALOG);
  expect(loaded.version()).toBe(store.version());
  expect(() =>
    RealmStore.fromPack({ ...pack.manifest, entries: [] }, () => undefined, SYNTHETIC_CATALOG),
  ).toThrow('индекса мира');
  expect(() =>
    RealmStore.fromPack(
      { ...pack.manifest, schemaVersion: 2 as 1 },
      () => undefined,
      SYNTHETIC_CATALOG,
    ),
  ).toThrow('ASSET_SCHEMA');
});
