import {
  IdAllocator,
  InMemoryIdLeaseProvider,
  makeEntityId,
  type EntityId,
} from '@duskmarch/domain';
import { describe, expect, it } from 'vitest';
import { PartitionCore, type Entity } from '../engine/partition.js';
import { DirtyTracker, FIELD } from './dirty-tracker.js';
import { FlushCoordinator, orderRows, type FlushBatch, type WorldRowOut } from './flush.js';
import { entityToRow } from './flush-store.js';

async function bench(
  opts: { fail?: (batch: FlushBatch) => Error | null; conflicts?: number[] } = {},
) {
  const allocator = new IdAllocator(new InMemoryIdLeaseProvider(), { leaseSize: 4_096 });
  await allocator.ready();
  let tracker: DirtyTracker<WorldRowOut> | null = null;
  const core = new PartitionCore({
    partitionId: 'dawn-0',
    realm: { key: 'dawn', width: 4096, height: 4096 },
    bounds: { minX: 0, minY: 0, maxX: 4095, maxY: 4095 },
    allocator,
    onDirty: (id, reason) => tracker?.onDirty(id, reason),
  });
  core.hydrate([]);
  let wall = 0;
  let perf = 0;
  tracker = new DirtyTracker(
    core,
    (e) => entityToRow('ember', 'dawn', e, (id) => core.get(id)),
    () => wall,
  );
  const batches: FlushBatch[] = [];
  const heroes: EntityId[][] = [];
  const modes: string[] = [];
  let stale = 0;
  const flush = new FlushCoordinator(
    tracker,
    {
      writeBatch: async (batch) => {
        const err = opts.fail?.(batch);
        if (err) throw err;
        batches.push(batch);
        const conflicts = new Set(opts.conflicts ?? []);
        return {
          written: batch.upserts.map((u) => u.row.entityId).filter((id) => !conflicts.has(id)),
          deleted: batch.deletes.map((d) => d.entityId),
          conflicts: [...conflicts].filter((id) =>
            batch.upserts.some((u) => u.row.entityId === id),
          ),
        };
      },
      writeHeroes: async (ids) => void heroes.push([...ids]),
    },
    {
      perfNow: () => perf,
      wallNow: () => wall,
      sleep: async () => undefined,
      random: () => 0.5,
      onMode: (m) => modes.push(m),
      onStale: () => stale++,
    },
  );
  /** Цикл: тики до конца снимка, затем ожидание записи. */
  const run = async (perTickMs = 0) => {
    const done = flush.flush();
    for (let i = 0; i < 10_000 && flush.busy; i++) {
      perf += perTickMs;
      flush.tick();
      await Promise.resolve();
    }
    await done;
  };
  return {
    core,
    tracker,
    flush,
    batches,
    heroes,
    modes,
    run,
    setWall: (v: number) => (wall = v),
    advancePerf: (v: number) => (perf += v),
    staleCount: () => stale,
  };
}

const item = (core: PartitionCore, x = 5) =>
  core.create('item', { placement: { kind: 'world', x, y: 5, h: 0 } });

describe('persistence/incremental-save: фоновое сохранение', () => {
  it('1 250 изменений — пакеты 500/500/250, версии растут, метрики', async () => {
    const b = await bench();
    for (let i = 0; i < 1_250; i++) item(b.core, i % 4_000);
    b.setWall(60_000);
    await b.run();
    expect(b.batches.map((x) => x.upserts.length)).toEqual([500, 500, 250]);
    expect(b.tracker.size).toBe(0);
    expect(b.flush.metrics).toMatchObject({
      rowsUpserted: 1_250,
      flushLagMs: 0,
      lastSuccessfulFlushAt: 60_000,
    });
    const first = b.batches[0]?.upserts[0];
    expect(first?.expectedVersion).toBe(0);
    expect(b.tracker.versionOf(first?.row.entityId as EntityId)).toBe(1);
  });

  it('пустая очередь — без записей; параллельный вызов не запускает второй цикл', async () => {
    const b = await bench();
    await b.run();
    expect(b.batches).toEqual([]);
    item(b.core);
    const p1 = b.flush.flush();
    const p2 = b.flush.flush();
    expect(p2).toBe(p1);
    for (let i = 0; i < 10 && b.flush.busy; i++) {
      b.flush.tick();
      await Promise.resolve();
    }
    await p1;
    expect(b.batches).toHaveLength(1);
  });

  it('снимок порциями: бюджет 5 мс на тик', async () => {
    const b = await bench();
    for (let i = 0; i < 100; i++) item(b.core, i);
    const done = b.flush.flush();
    let ticks = 0;
    const origTick = b.flush.tick.bind(b.flush);
    while (b.flush.busy && ticks < 1_000) {
      b.advancePerf(0);
      // каждая сущность «стоит» 1 мс: бюджет 5 мс → не больше 5–6 сущностей за тик
      const perfStep = () => b.advancePerf(1);
      const realCapture = b.tracker.capture.bind(b.tracker);
      b.tracker.capture = ((limit?: number, from?: Iterable<EntityId>) => {
        perfStep();
        return realCapture(limit, from);
      }) as typeof b.tracker.capture;
      origTick();
      b.tracker.capture = realCapture;
      ticks++;
      await Promise.resolve();
    }
    await done;
    expect(ticks).toBeGreaterThanOrEqual(20);
    expect(b.flush.metrics.captureSliceMaxMs).toBeLessThanOrEqual(5);
  });

  it('конфликт версий: устаревшее изменение пропускается, остальные пишутся', async () => {
    const first = makeEntityId('item', 1);
    const b = await bench({ conflicts: [first] });
    const x = item(b.core);
    const y = item(b.core, 6);
    expect(x.id).toBe(first);
    await b.run();
    expect(b.flush.metrics.versionConflictsTotal).toBe(1);
    expect(b.tracker.size).toBe(0);
    expect(b.tracker.versionOf(y.id)).toBe(1);
  });

  it('порядок: сундук раньше вложенных; удаления — вложенные раньше', async () => {
    const b = await bench();
    const chest = item(b.core);
    const inner = Array.from({ length: 5 }, () =>
      b.core.create('item', { placement: { kind: 'container', parent: chest.id } }),
    );
    await b.run();
    const ids = b.batches[0]?.upserts.map((u) => u.row.entityId);
    expect(ids?.[0]).toBe(chest.id);
    expect(b.batches[0]?.upserts[1]?.row).toMatchObject({
      parentId: chest.id,
      rootOwnerId: chest.id,
      placement: 'container',
    });
    for (const i of inner) b.core.despawn(i.id, true);
    b.core.despawn(chest.id, true);
    await b.run();
    expect(b.batches[1]?.deletes.at(-1)?.entityId).toBe(chest.id);
    expect(b.flush.metrics.rowsSoftDeleted).toBe(6);
    const ordered = orderRows([
      {
        id: 1 as EntityId,
        kind: 'item',
        mask: FIELD.CREATED,
        row: { entityId: 1, kind: 'item', parentId: 2 },
      },
      {
        id: 2 as EntityId,
        kind: 'item',
        mask: FIELD.CREATED,
        row: { entityId: 2, kind: 'item', parentId: null },
      },
    ]);
    expect(ordered.upserts.map((u) => u.id)).toEqual([2, 1]);
  });

  it('взаимная блокировка: повтор пакета; герои пишутся отдельно', async () => {
    let fails = 1;
    const b = await bench({
      fail: () => (fails-- > 0 ? Object.assign(new Error('deadlock'), { code: '40P01' }) : null),
    });
    item(b.core);
    const hero: Entity = {
      id: makeEntityId('hero', 1),
      kind: 'hero',
      placement: { kind: 'world', x: 1, y: 1, h: 0 },
      player: true,
      height: 7,
      blocksSight: false,
      behaviors: [],
    };
    b.core.spawn(hero);
    b.core.move(hero.id, 2, 1, 0);
    await b.run();
    expect(b.flush.metrics.retriesTotal).toBe(1);
    expect(b.heroes).toEqual([[hero.id]]);
    expect(b.tracker.size).toBe(0);
  });

  it('отказ БД: отметки сохраняются; больше 180 с — read_only_degraded; восстановление снимает режим', async () => {
    let down = true;
    const b = await bench({ fail: () => (down ? new Error('ECONNREFUSED') : null) });
    item(b.core);
    b.setWall(1_000);
    await b.run();
    expect(b.tracker.size).toBe(1);
    expect(b.flush.metrics.flushFailuresTotal).toBeGreaterThan(0);
    b.setWall(180_001);
    b.flush.tick();
    expect(b.flush.mode).toBe('read_only_degraded');
    expect(b.modes).toEqual(['read_only_degraded']);
    down = false;
    await b.run();
    expect(b.flush.mode).toBe('normal');
    expect(b.modes).toEqual(['read_only_degraded', 'normal']);
  });

  it('устаревшая эпоха: запись прекращается, партиция останавливается', async () => {
    const b = await bench({
      fail: () => Object.assign(new Error('stale'), { code: 'PERSIST_FENCING_TOKEN_STALE' }),
    });
    item(b.core);
    await b.run();
    expect(b.staleCount()).toBe(1);
    expect(b.flush.stopped).toBe(true);
    await b.flush.flush();
    await expect(b.flush.flushNow()).resolves.toBe(0);
  });
});
