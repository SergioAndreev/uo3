import type { EntityId } from '@duskmarch/domain';
import type { WorldRow } from '@duskmarch/db/world';
import { describe, expect, it } from 'vitest';
import { flush, HeadlessShard } from '../testing/harness.js';
import { ComponentMigrations, linkContainers, rowToEntity } from './loader.js';

const now = new Date('2026-11-26T10:00:00Z');
const row = (entityId: number, extra: Partial<WorldRow> = {}): WorldRow => ({
  shardId: 'local-dev',
  entityId,
  kind: 'item',
  contentKey: 'item.rye-bread',
  placement: 'world',
  realm: 'proving',
  x: 10,
  y: 10,
  h: 0,
  parentId: null,
  slot: null,
  rootOwnerId: null,
  rect: null,
  amount: 1,
  components: {},
  schemaVersion: 1,
  entityVersion: 1,
  changeSeq: 0,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...extra,
});
const inside = (id: number, parent: number, root = 0x60000001) =>
  row(id, {
    placement: 'container',
    parentId: parent,
    rootOwnerId: root,
    realm: null,
    x: null,
    y: null,
    h: null,
  });

describe('persistence/world-store: связывание и карантин', () => {
  it('строки → сущности ядра с размещением и данными', () => {
    expect(rowToEntity(row(0x60000001))).toMatchObject({
      kind: 'item',
      placement: { kind: 'world', x: 10, y: 10, h: 0 },
      data: { contentKey: 'item.rye-bread', entityVersion: 1 },
    });
    expect(rowToEntity(inside(0x60000002, 0x60000001))?.placement).toEqual({
      kind: 'container',
      parent: 0x60000001,
    });
    expect(
      rowToEntity(
        row(0x60000003, {
          placement: 'bank',
          parentId: 0x60000009,
          realm: null,
          x: null,
          y: null,
          h: null,
        }),
      )?.placement,
    ).toEqual({ kind: 'container', parent: 0x60000009 });
    expect(
      rowToEntity(
        row(0x60000004, {
          placement: 'equipped',
          parentId: 0x20000001,
          slot: 'main-hand',
          realm: null,
          x: null,
          y: null,
          h: null,
        }),
      )?.placement,
    ).toEqual({ kind: 'equipped', holder: 0x20000001, slot: 'main-hand' });
    expect(rowToEntity(row(0x60000005, { placement: 'limbo' }))).toBeNull();
    expect(
      rowToEntity(
        row(0x80000001, { kind: 'structure', rect: { minX: 1, minY: 1, maxX: 4, maxY: 4 } }),
      )?.rect,
    ).toEqual({ minX: 1, minY: 1, maxX: 4, maxY: 4 });
  });

  it('strict: битая ссылка останавливает загрузку со списком идентификаторов', () => {
    const rows = [row(0x60000001), inside(0x60000500, 0x60000499)];
    expect(() => linkContainers(rows, 'strict')).toThrow(
      expect.objectContaining({
        code: 'PERSIST_WORLD_LOAD_CORRUPTED',
        details: expect.objectContaining({ entityIds: [0x60000500] }),
      }),
    );
  });

  it('quarantine: сирота и его содержимое изолируются, остальное загружается', () => {
    const rows = [
      row(0x60000001),
      inside(0x60000002, 0x60000001),
      inside(0x60000500, 0x60000499),
      inside(0x60000501, 0x60000500),
    ];
    const r = linkContainers(rows, 'quarantine');
    expect(r.entities.map((e) => e.id)).toEqual([0x60000001, 0x60000002]);
    expect(r.quarantined.map((q) => q.row.entityId).sort()).toEqual([0x60000500, 0x60000501]);
  });

  it('цикл блокирует загрузку даже в карантине; повтор идентификатора тоже', () => {
    const cycle = [inside(0x6000000a, 0x6000000b), inside(0x6000000b, 0x6000000a)];
    expect(() => linkContainers(cycle, 'quarantine')).toThrow(
      expect.objectContaining({ code: 'PERSIST_CONTAINER_CYCLE_DETECTED' }),
    );
    expect(() => linkContainers([row(0x60000001), row(0x60000001)], 'quarantine')).toThrow(
      expect.objectContaining({ code: 'PERSIST_WORLD_LOAD_CORRUPTED' }),
    );
  });

  it('глубина больше 10 — карантин', () => {
    const rows = [row(0x60000100)];
    for (let i = 1; i <= 11; i++) rows.push(inside(0x60000100 + i, 0x60000100 + i - 1, 0x60000100));
    const r = linkContainers(rows, 'quarantine');
    expect(r.quarantined.map((q) => q.row.entityId)).toEqual([0x6000010b]);
    expect(r.entities).toHaveLength(11);
  });

  it('миграции компонентов 1 → 2 → 3; новее поддерживаемой — отказ', () => {
    const migrations = new ComponentMigrations([
      (c) => ({ ...c, durability: 100 }),
      (c) => ({ ...c, wear: 100 - (c.durability as number) }),
    ]);
    const r = linkContainers(
      [row(0x60000001), row(0x60000002, { schemaVersion: 3 })],
      'strict',
      migrations,
    );
    expect(r.migrated).toEqual([0x60000001]);
    expect(r.entities[0]?.data).toMatchObject({
      schemaVersion: 3,
      components: { durability: 100, wear: 0 },
    });
    expect(() =>
      linkContainers([row(0x60000003, { schemaVersion: 4 })], 'strict', migrations),
    ).toThrow(expect.objectContaining({ code: 'PERSIST_UNSUPPORTED_SCHEMA_VERSION' }));
  });

  it('дерево героя загружается при входе и выгружается при выходе', async () => {
    const shard = await HeadlessShard.create();
    const heroId = 0x20000001 as EntityId;
    const tree = linkContainers(
      [
        row(0x60000010, {
          placement: 'equipped',
          parentId: heroId,
          slot: 'pack',
          rootOwnerId: heroId,
          realm: null,
          x: null,
          y: null,
          h: null,
        }),
        inside(0x60000011, 0x60000010, heroId),
        row(0x60000012, {
          placement: 'equipped',
          parentId: heroId,
          slot: 'main-hand',
          rootOwnerId: heroId,
          realm: null,
          x: null,
          y: null,
          h: null,
        }),
      ],
      'strict',
      undefined,
      new Set([heroId]),
    ).entities;
    const { session } = await shard.player('acc-1');
    shard.heroTrees.set(session.entityId, tree);
    shard.partition.sessions.logout(session);
    shard.advanceMs(200_000);
    await flush();
    const again = await shard.player('acc-1');
    expect(again.session.entityId).toBe(session.entityId);
    expect(shard.partition.core.get(0x60000011 as EntityId)?.placement).toEqual({
      kind: 'container',
      parent: 0x60000010,
    });
    expect(again.session.owned).toHaveLength(3);
    shard.partition.sessions.logout(again.session);
    shard.advanceMs(200_000);
    await flush();
    expect(shard.partition.core.get(0x60000011 as EntityId)).toBeUndefined();
  });
});
