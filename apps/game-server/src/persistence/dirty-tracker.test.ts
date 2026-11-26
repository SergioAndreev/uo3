import {
  IdAllocator,
  InMemoryIdLeaseProvider,
  makeEntityId,
  type EntityId,
} from '@duskmarch/domain';
import { describe, expect, it } from 'vitest';
import { PartitionCore, type Entity } from '../engine/partition.js';
import { DirtyTracker, FIELD } from './dirty-tracker.js';

async function setup() {
  const allocator = new IdAllocator(new InMemoryIdLeaseProvider(), { leaseSize: 256 });
  await allocator.ready();
  let tracker: DirtyTracker<{ id: number; x: number | null }> | null = null;
  const core = new PartitionCore({
    partitionId: 'dawn-0',
    realm: { key: 'dawn', width: 4096, height: 4096 },
    bounds: { minX: 0, minY: 0, maxX: 4095, maxY: 4095 },
    allocator,
    onDirty: (id, reason) => tracker?.onDirty(id, reason),
  });
  const serialize = (e: Entity) => ({
    id: e.id,
    x: e.placement.kind === 'world' ? e.placement.x : null,
  });
  tracker = new DirtyTracker(core, serialize, () => 1_000);
  const t = tracker;
  core.hydrate([]);
  return { core, t };
}

const hero = (n: number): Entity => ({
  id: makeEntityId('hero', n),
  kind: 'hero',
  placement: { kind: 'world', x: 10, y: 10, h: 0 },
  player: true,
  height: 7,
  blocksSight: false,
  behaviors: [],
});

describe('persistence/incremental-save: отметки изменений', () => {
  it('много изменений — одна запись с объединённой маской', async () => {
    const { core, t } = await setup();
    core.spawn(hero(1));
    const id = makeEntityId('hero', 1);
    expect(t.size).toBe(0);
    for (let i = 0; i < 120; i++) core.move(id, 10 + (i % 5), 10, 0);
    t.mark(id, FIELD.VITALS);
    t.mark(id, FIELD.SKILLS);
    expect(t.size).toBe(1);
    expect(t.entry(id)?.mask).toBe(FIELD.POSITION | FIELD.VITALS | FIELD.SKILLS);
    expect(t.oldestMs).toBe(1_000);
  });

  it('загруженная сущность не считается созданной; новая — CREATED; эфемерное не отмечается', async () => {
    const { core, t } = await setup();
    const loaded: Entity = {
      ...hero(2),
      id: 0x60001000 as EntityId,
      kind: 'item',
      player: false,
      data: {
        contentKey: 'item.rye-bread',
        amount: 1,
        components: {},
        schemaVersion: 1,
        entityVersion: 3,
        rootOwnerId: null,
      },
    };
    core.spawn(loaded);
    expect(t.size).toBe(0);
    const fresh = core.create('item', { placement: { kind: 'world', x: 5, y: 5, h: 0 } });
    expect(t.entry(fresh.id)?.mask).toBe(FIELD.CREATED);
    expect(t.versionOf(loaded.id)).toBe(3);
  });

  it('создан и удалён до записи — схлопывается; удаление записанного — DELETED', async () => {
    const { core, t } = await setup();
    const tmp = core.create('item', { placement: { kind: 'world', x: 5, y: 5, h: 0 } });
    core.despawn(tmp.id, true);
    expect(t.size).toBe(0);
    const kept = core.create('item', { placement: { kind: 'world', x: 6, y: 5, h: 0 } });
    const [snap] = t.capture();
    t.ack(kept.id, snap?.changeSeq as number, 1);
    expect(t.size).toBe(0);
    core.despawn(kept.id, true);
    const [del] = t.capture();
    expect(del).toMatchObject({ id: kept.id, mask: FIELD.DELETED, version: 1, row: null });
  });

  it('изменение во время записи: отметка не снимается', async () => {
    const { core, t } = await setup();
    const item = core.create('item', { placement: { kind: 'world', x: 5, y: 5, h: 0 } });
    const [snap] = t.capture();
    core.move(item.id, 7, 5, 0);
    t.ack(item.id, snap?.changeSeq as number, 1);
    expect(t.entry(item.id)).toMatchObject({ mask: FIELD.POSITION, version: 1 });
    const [next] = t.capture();
    expect(next?.row).toEqual({ id: item.id, x: 7 });
    t.ack(item.id, next?.changeSeq as number, null);
    expect(t.size).toBe(0);
    expect(t.oldestMs).toBeNull();
  });

  it('выгрузка с несохранёнными изменениями: строка снимается до ухода из памяти', async () => {
    const { core, t } = await setup();
    const item = core.create('item', { placement: { kind: 'world', x: 5, y: 5, h: 0 } });
    core.move(item.id, 9, 5, 0);
    core.despawn(item.id);
    expect(core.get(item.id)).toBeUndefined();
    expect(t.capture()[0]?.row).toEqual({ id: item.id, x: 9 });
  });

  it('критическая транзакция сохранила сущность: отметка снимается до её changeSeq', async () => {
    const { core, t } = await setup();
    const item = core.create('item', { placement: { kind: 'world', x: 5, y: 5, h: 0 } });
    const seq = t.changeSeq;
    t.settle(item.id, 2, seq);
    expect(t.size).toBe(0);
    expect(t.versionOf(item.id)).toBe(2);
    core.move(item.id, 6, 5, 0);
    t.settle(item.id, 3, seq);
    expect(t.entry(item.id)?.version).toBe(3);
    t.settle(0x60000999 as EntityId, 1);
    t.mark(0x60000998 as EntityId, FIELD.VITALS);
    expect(t.capture(1)).toHaveLength(1);
  });
});
