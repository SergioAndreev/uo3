import {
  IdAllocator,
  InMemoryIdLeaseProvider,
  kindOf,
  makeEntityId,
  type EntityId,
} from '@duskmarch/domain';
import { describe, expect, it } from 'vitest';
import { PartitionCore, type Entity, type PartitionEvent } from './partition.js';
import { SpatialIndex, type SectorEvent } from './spatial-index.js';

const DAWN = { key: 'dawn', width: 4096, height: 4096 };
const FULL = { minX: 0, minY: 0, maxX: 4095, maxY: 4095 };

async function partition(over: Partial<ConstructorParameters<typeof PartitionCore>[0]> = {}) {
  const allocator = new IdAllocator(new InMemoryIdLeaseProvider(), { leaseSize: 256 });
  await allocator.ready();
  const events: PartitionEvent[] = [];
  const dirty: [EntityId, string][] = [];
  const core = new PartitionCore({
    partitionId: 'dawn-0',
    realm: DAWN,
    bounds: FULL,
    allocator,
    onEvent: (e) => events.push(e),
    onDirty: (id, reason) => dirty.push([id, reason]),
    ...over,
  });
  return { core, events, dirty, allocator };
}

const hero = (n: number, x: number, y: number): Entity => ({
  id: makeEntityId('hero', n),
  kind: 'hero',
  placement: { kind: 'world', x, y, h: 0 },
  player: true,
  height: 7,
  blocksSight: false,
  behaviors: [],
});

describe('пространственный индекс', () => {
  it('перемещение внутри сектора не трогает коллекции, через границу — переносит', () => {
    const index = new SpatialIndex();
    const id = makeEntityId('hero', 1);
    index.insert(id, 'creature', 16, 16, true);
    const before = index.inSector(1, 1, 'players');
    index.move(id, 17, 16);
    expect(index.inSector(1, 1, 'players')).toEqual(before);
    index.move(id, 15, 16);
    expect(index.inSector(1, 1, 'creatures')).toEqual([]);
    expect(index.inSector(0, 1, 'players')).toEqual([id]);
    expect(index.position(id)).toEqual({ x: 15, y: 16 });
  });

  it('постройка в четырёх секторах; удаление из всех', () => {
    const index = new SpatialIndex();
    const id = makeEntityId('structure', 1);
    index.insertStructure(id, { minX: 12, minY: 12, maxX: 22, maxY: 22 });
    expect(index.sectorsOf(id).sort()).toEqual(
      [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
      ].sort(),
    );
    index.remove(id);
    expect(
      [0, 1].flatMap((sx) => [0, 1].map((sy) => index.inSector(sx, sy, 'structures').length)),
    ).toEqual([0, 0, 0, 0]);
    expect(index.remove(id)).toBe(false);
  });

  it('Чебышёв на границе AOI, постройки на 32 клетках, клетка, упорядочивание и ранний выход', () => {
    const index = new SpatialIndex();
    const a = makeEntityId('creature', 2);
    const b = makeEntityId('creature', 1);
    index.insert(a, 'creature', 120, 120);
    index.insert(b, 'creature', 121, 100);
    const seen: EntityId[] = [];
    index.forEachInRange('creatures', 100, 100, 20, (id) => void seen.push(id));
    expect(seen).toEqual([a]);
    const house = makeEntityId('structure', 9);
    index.insertStructure(house, { minX: 128, minY: 90, maxX: 140, maxY: 110 });
    expect(index.structuresInRange(100, 100, 20)).toEqual([]);
    expect(index.structuresInRange(100, 100, 32)).toEqual([house]);
    index.insert(makeEntityId('item', 1), 'item', 1420, 1690);
    index.insert(makeEntityId('item', 2), 'item', 1420, 1690);
    index.insert(makeEntityId('creature', 3), 'creature', 1420, 1690);
    index.insert(makeEntityId('item', 3), 'item', 1421, 1690);
    const here: string[] = [];
    index.forEachAt(1420, 1690, (id, kind) => void here.push(`${kind}:${id}`));
    expect(here).toHaveLength(3);
    expect(index.sectorOf(1420, 1690)).toEqual([88, 105]);
    const ordered: EntityId[] = [];
    index.forEachInRange('creatures', 110, 110, 20, (id) => void ordered.push(id), true);
    expect(ordered).toEqual([b, a]);
    let visits = 0;
    index.forEachInRange('creatures', 110, 110, 20, () => (visits++, false));
    expect(visits).toBe(1);
    let pointVisits = 0;
    index.forEachAt(1420, 1690, () => (pointVisits++, false));
    expect(pointVisits).toBe(1);
  });

  it('активация 25 секторов, усыпление, пересечение двух игроков', () => {
    const events: SectorEvent[] = [];
    const index = new SpatialIndex(16, (e) => events.push(e));
    const p1 = makeEntityId('hero', 1);
    index.insert(p1, 'creature', 10 * 16, 10 * 16, true);
    expect(events.filter((e) => e.type === 'activated')).toHaveLength(25);
    events.length = 0;
    index.move(p1, 50 * 16, 50 * 16);
    expect(events.filter((e) => e.type === 'deactivated')).toHaveLength(25);
    expect(events.filter((e) => e.type === 'activated')).toHaveLength(25);
    index.remove(p1);
    events.length = 0;
    const a = makeEntityId('hero', 2);
    const b = makeEntityId('hero', 3);
    index.insert(a, 'creature', 160, 160, true);
    index.insert(b, 'creature', 192, 160, true);
    events.length = 0;
    index.remove(a);
    const off = events
      .filter((e) => e.type === 'deactivated')
      .map((e) => `${e.sx},${e.sy}`)
      .sort();
    expect(off).toEqual(
      [8, 9].flatMap((sx) => [8, 9, 10, 11, 12].map((sy) => `${sx},${sy}`)).sort(),
    );
    expect(index.isActive(10, 10)).toBe(true);
    expect(index.activeSectorCount).toBe(25);
  });
});

describe('ядро партиции', () => {
  it('сетки секторов; подпартиция; невалидные границы', async () => {
    expect((await partition()).core.grid).toEqual([256, 256]);
    const proving = await partition({
      realm: { key: 'proving', width: 256, height: 256 },
      bounds: { minX: 0, minY: 0, maxX: 255, maxY: 255 },
    });
    expect(proving.core.grid).toEqual([16, 16]);
    expect(
      (await partition({ bounds: { minX: 0, minY: 0, maxX: 2047, maxY: 4095 } })).core.grid,
    ).toEqual([128, 256]);
    for (const bounds of [
      { minX: 10, minY: 0, maxX: 999, maxY: 999 },
      { minX: 0, minY: 0, maxX: 4999, maxY: 4095 },
    ]) {
      await expect(partition({ bounds })).rejects.toMatchObject({
        code: 'PARTITION_INVALID_BOUNDS',
      });
    }
  });

  it('гидратация: 250 предметов и 40 существ; повтор и выход за границу', async () => {
    const { core } = await partition();
    expect(core.state).toBe('LOADING');
    const items: Entity[] = Array.from({ length: 250 }, (_, i) => ({
      id: makeEntityId('item', i + 1),
      kind: 'item',
      placement: { kind: 'world', x: i, y: 5, h: 0 },
      player: false,
      height: 1,
      blocksSight: false,
      behaviors: [],
    }));
    const npcs: Entity[] = Array.from({ length: 40 }, (_, i) => ({
      id: makeEntityId('creature', i + 1),
      kind: 'creature',
      placement: { kind: 'world', x: i, y: 9, h: 0 },
      player: false,
      height: 6,
      blocksSight: false,
      behaviors: [],
    }));
    core.hydrate([...items, ...npcs]);
    expect(core.state).toBe('ACTIVE');
    expect(core.size).toBe(290);
    const broken = await partition({ bounds: { minX: 0, minY: 0, maxX: 2047, maxY: 4095 } });
    expect(() => broken.core.hydrate([items[0] as Entity, items[0] as Entity])).toThrow(
      expect.objectContaining({ code: 'PARTITION_HYDRATION_FAILED' }),
    );
    expect(() =>
      broken.core.hydrate([
        { ...(npcs[0] as Entity), placement: { kind: 'world', x: 3000, y: 1, h: 0 } },
      ]),
    ).toThrow(expect.objectContaining({ code: 'PARTITION_HYDRATION_FAILED' }));
    expect(broken.core.size).toBe(0);
    expect(broken.core.state).toBe('LOADING');
  });

  it('идентификаторы существ и предметов, коллизия, спавн вне границ', async () => {
    const { core } = await partition({ bounds: { minX: 0, minY: 0, maxX: 2047, maxY: 4095 } });
    core.hydrate([]);
    const npc = core.create('creature', { placement: { kind: 'world', x: 5, y: 5, h: 0 } });
    const item = core.create('item', { placement: { kind: 'world', x: 6, y: 5, h: 0 } });
    expect([kindOf(npc.id), kindOf(item.id)]).toEqual(['creature', 'item']);
    expect(core.get(npc.id)).toBe(npc);
    expect(() => core.spawn({ ...npc })).toThrow(
      expect.objectContaining({ code: 'ERR_ENTITY_ID_COLLISION' }),
    );
    expect(() =>
      core.create('creature', { placement: { kind: 'world', x: 3000, y: 100, h: 0 } }),
    ).toThrow(expect.objectContaining({ code: 'PARTITION_ENTITY_OUT_OF_BOUNDS' }));
    expect(() =>
      core.spawn({ ...hero(9, 1, 1), placement: { kind: 'container', parent: item.id } }),
    ).toThrow(expect.objectContaining({ code: 'PARTITION_PLACEMENT_INVALID' }));
    expect(() =>
      core.create('structure', {
        placement: { kind: 'world', x: 2040, y: 0, h: 0 },
        rect: { minX: 2040, minY: 0, maxX: 2060, maxY: 5 },
      }),
    ).toThrow(expect.objectContaining({ code: 'PARTITION_ENTITY_OUT_OF_BOUNDS' }));
    expect(() => core.move(npc.id, 3000, 1, 0)).toThrow(
      expect.objectContaining({ code: 'PARTITION_ENTITY_OUT_OF_BOUNDS' }),
    );
  });

  it('предмет: земля → рюкзак → снаряжение; одно состояние', async () => {
    const { core } = await partition();
    core.hydrate([]);
    const player = core.spawn(hero(1, 1420, 1690));
    const pack = core.create('item', {
      placement: { kind: 'equipped', holder: player.id, slot: 'pack' },
    });
    const blade = core.create('item', { placement: { kind: 'world', x: 1420, y: 1690, h: 0 } });
    expect(core.index.inSector(88, 105, 'items')).toEqual([blade.id]);
    core.place(blade.id, { kind: 'container', parent: pack.id });
    expect(core.index.inSector(88, 105, 'items')).toEqual([]);
    expect(core.get(blade.id)?.placement).toEqual({ kind: 'container', parent: pack.id });
    core.place(blade.id, { kind: 'equipped', holder: player.id, slot: 'main-hand' });
    expect(core.get(blade.id)?.placement).toEqual({
      kind: 'equipped',
      holder: player.id,
      slot: 'main-hand',
    });
    expect(core.index.has(blade.id)).toBe(false);
    core.place(blade.id, { kind: 'world', x: 1421, y: 1690, h: 0 });
    expect(core.index.has(blade.id)).toBe(true);
    expect(() => core.place(player.id, { kind: 'world', x: 1, y: 1, h: 0 })).toThrow(
      expect.objectContaining({ code: 'PARTITION_PLACEMENT_INVALID' }),
    );
    expect(() => core.place(blade.id, { kind: 'container', parent: blade.id })).toThrow(
      expect.objectContaining({ code: 'PARTITION_PLACEMENT_INVALID' }),
    );
    expect(() => core.place(blade.id, { kind: 'world', x: 5000, y: 1, h: 0 })).toThrow(
      expect.objectContaining({ code: 'PARTITION_ENTITY_OUT_OF_BOUNDS' }),
    );
  });

  it('динамические клетки: только предметы на земле и постройки, ранний выход, препятствия обзора', async () => {
    const { core } = await partition();
    core.hydrate([]);
    const player = core.spawn(hero(1, 200, 200));
    const pack = core.create('item', {
      placement: { kind: 'equipped', holder: player.id, slot: 'pack' },
    });
    for (let i = 0; i < 3; i++)
      core.create('item', { placement: { kind: 'world', x: 200, y: 200, h: 0 }, height: 2 });
    core.create('item', { placement: { kind: 'container', parent: pack.id } });
    let n = 0;
    core.forEachDynamicAt(200, 200, () => void n++);
    expect(n).toBe(3);
    n = 0;
    core.forEachDynamicAt(200, 200, () => (n++, false));
    expect(n).toBe(1);
    const wall = core.create('item', {
      placement: { kind: 'world', x: 210, y: 210, h: 0 },
      height: 8,
      blocksSight: true,
    });
    expect(core.obstaclesAt(210, 210)).toEqual([{ base: 0, top: 8, blocksSight: true }]);
    core.despawn(wall.id, true);
    expect(core.obstaclesAt(210, 210)).toEqual([]);
  });

  it('поведения: порядок хуков; dirty-tracking и события', async () => {
    const { core, events, dirty } = await partition();
    core.hydrate([]);
    const calls: string[] = [];
    for (const key of ['a', 'b']) {
      core.registerBehavior(key, () => ({
        key,
        onSpawn: () => calls.push(`${key}:spawn`),
        onMove: (_e, from, to) => calls.push(`${key}:move ${from.x}→${to.x}`),
        onDespawn: () => calls.push(`${key}:despawn`),
        onTick: (_e, t) => calls.push(`${key}:tick${t}`),
      }));
    }
    const npc: Entity = {
      id: makeEntityId('creature', 77),
      kind: 'creature',
      placement: { kind: 'world', x: 10, y: 10, h: 0 },
      player: false,
      height: 6,
      blocksSight: false,
      behaviors: [],
    };
    core.spawn(npc);
    core.attach(npc.id, 'a');
    core.attach(npc.id, 'b');
    core.attach(npc.id, 'нет');
    core.move(npc.id, 11, 10, 0);
    core.tick(5);
    core.despawn(npc.id);
    expect(calls).toEqual([
      'a:move 10→11',
      'b:move 10→11',
      'a:tick5',
      'b:tick5',
      'a:despawn',
      'b:despawn',
    ]);
    expect(events.map((e) => e.type)).toEqual([
      'entity.spawned',
      'entity.moved',
      'entity.despawned',
    ]);
    expect(dirty.map(([, r]) => r)).toEqual(['spawned', 'moved', 'despawned']);
    expect(core.despawn(npc.id)).toBe(false);
  });

  it('ёмкость: 500 игроков, буфер персонала; утилизация', async () => {
    const { core } = await partition({ hardCapacity: 500, staffBuffer: 20 });
    core.hydrate([]);
    for (let i = 1; i <= 500; i++) core.spawn(hero(i, i % 4000, 1));
    expect(core.admits('player')).toBe(false);
    expect(core.admits('game-master')).toBe(true);
    let flushed = 0;
    core.dispose((all) => (flushed = all.length));
    expect(flushed).toBe(500);
    expect(core.state).toBe('DISPOSED');
    expect(core.size).toBe(0);
    expect(core.index.activeSectorCount).toBe(0);
    expect(core.all()).toEqual([]);
  });
});
