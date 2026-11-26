import { Decoder, Encoder, StateView } from '@colyseus/schema';
import type { EntityId } from '@duskmarch/domain';
import { HubState, PartitionState } from '@duskmarch/protocol/state';
import { describe, expect, it } from 'vitest';
import { InterestManager, type Observer } from './interest.js';
import {
  ProjectionSync,
  type BeingView,
  type ContainerItemView,
  type ItemView,
  type PrivateView,
  type Relation,
  type StructureView,
} from './projection.js';

const being = (x: number, y: number, extra: Partial<BeingView> = {}): BeingView => ({
  kind: 'hero',
  name: 'Ясна',
  model: 'hero.frame-humanoid',
  tint: 9,
  x,
  y,
  h: 0,
  direction: 2,
  baseReputation: 'neutral',
  statusFlags: 0,
  healthPercent: 87,
  mountModel: '',
  mountTint: 0,
  equipment: {},
  ...extra,
});
const priv = (extra: Partial<PrivateView> = {}): PrivateView => ({
  might: 60,
  finesse: 30,
  will: 20,
  health: 87,
  maxHealth: 100,
  verve: 50,
  maxVerve: 60,
  resonance: 80,
  maxResonance: 90,
  weightKg: 210,
  maxWeightKg: 390,
  money: 15_400,
  defense: 12,
  personalLight: 0,
  offenderRemainingMs: 0,
  outcastKills: 0,
  ...extra,
});

/** Стенд: мир, область интереса, проекция, кодировщик и декодеры клиентов. */
function bench(relations: (o: EntityId, t: EntityId) => Relation | null = () => null) {
  const beings = new Map<EntityId, BeingView>();
  const items = new Map<EntityId, ItemView>();
  const structures = new Map<EntityId, StructureView>();
  const inside = new Map<EntityId, ContainerItemView>();
  const privates = new Map<EntityId, PrivateView>();
  const state = new PartitionState();
  Object.assign(state, {
    shardId: 'ember',
    partitionId: 'dusk-0',
    realm: 'dusk',
    protocolVersion: '1.0.0',
  });
  const sync = new ProjectionSync(
    state,
    {
      being: (id) => beings.get(id),
      item: (id) => items.get(id),
      structure: (id) => structures.get(id),
      containerItem: (id) => inside.get(id),
      privateOf: (id) => privates.get(id),
    },
    relations,
  );
  const aoi = new InterestManager({ radius: 20, largeRadius: 32 });
  const encoder = new Encoder(state);
  const buffer = Buffer.alloc(256 * 1024);
  const clients = new Map<
    EntityId,
    { view: StateView; decoded: PartitionState; decoder: Decoder; bytes: number }
  >();
  const hero = (
    id: EntityId,
    x: number,
    y: number,
    v: Partial<BeingView> = {},
    p: Partial<PrivateView> = {},
  ) => {
    beings.set(id, being(x, y, v));
    privates.set(id, priv(p));
    aoi.upsert({ id, kind: 'being', realm: 'dusk', x, y });
    const o: Observer = {
      id,
      realm: 'dusk',
      x,
      y,
      level: 'player',
      detects: new Set(),
      targets: new Set(),
      group: new Set(),
    };
    aoi.addObserver(o);
    const view = new StateView();
    sync.addClient(id, view);
    const decoded = new PartitionState();
    clients.set(id, { view, decoded, decoder: new Decoder(decoded), bytes: 0 });
    return o;
  };
  /** Конец тика: область интереса → проекция → патч каждому клиенту. */
  const tick = () => {
    for (const [id, diff] of aoi.flush()) sync.apply(id, diff);
    for (const id of clients.keys()) sync.syncContents(id, aoi.containerContents(id));
    sync.flush();
    const it = { offset: 0 };
    encoder.encode(it, undefined, buffer);
    const shared = it.offset;
    for (const c of clients.values()) {
      const bytes = encoder.encodeView(c.view, shared, it, buffer);
      c.bytes = bytes.byteLength - shared;
      c.decoder.decode(Uint8Array.from(bytes));
      it.offset = shared;
    }
    encoder.discardChanges();
  };
  const seen = (id: EntityId) => (clients.get(id) as { decoded: PartitionState }).decoded;
  /** Инвариант: чужой клиент не получил ни одного приватного состояния, кроме своего. */
  const assertNoPrivateDataLeak = () => {
    for (const [id, c] of clients) {
      expect([...c.decoded.privates.keys()]).toEqual([String(id)]);
    }
  };
  return {
    beings,
    items,
    structures,
    inside,
    privates,
    state,
    sync,
    aoi,
    hero,
    tick,
    seen,
    clients,
    assertNoPrivateDataLeak,
  };
}

describe('netcode/state-replication', () => {
  it('публичная проекция без точных характеристик; приватное — только владельцу', () => {
    const b = bench();
    b.hero(1, 100, 100);
    b.hero(2, 102, 100, { name: 'Ива' });
    b.tick();
    const forB = b.seen(2);
    expect(forB.beings.get('1')).toMatchObject({
      name: 'Ясна',
      healthPercent: 87,
      baseReputation: 'neutral',
    });
    expect(Object.keys(forB.beings.get('1')?.toJSON() ?? {})).not.toContain('money');
    expect(b.seen(1).privates.get('1')).toMatchObject({ money: 15_400, might: 60, weightKg: 210 });
    b.assertNoPrivateDataLeak();
    b.privates.set(1, priv({ resonance: 65, weightKg: 225 }));
    b.sync.markDirty(1);
    b.tick();
    expect(b.seen(1).privates.get('1')).toMatchObject({ resonance: 65, weightKg: 225 });
    b.assertNoPrivateDataLeak();
  });

  it('снаряжение и ездовое животное видят все наблюдатели', () => {
    const b = bench();
    b.hero(1, 100, 100);
    b.hero(2, 101, 100);
    b.tick();
    b.beings.set(
      1,
      being(100, 100, {
        mountModel: 'creature.dune-strider',
        equipment: { cloak: { model: 'item.wool-cloak', tint: 42 } },
      }),
    );
    b.sync.markDirty(1);
    b.tick();
    const seenByB = b.seen(2).beings.get('1');
    expect(seenByB?.mountModel).toBe('creature.dune-strider');
    expect(seenByB?.equipment.get('cloak')).toMatchObject({ model: 'item.wool-cloak', tint: 42 });
    b.beings.set(1, being(100, 100, { equipment: {} }));
    b.sync.markDirty(1);
    b.tick();
    expect(b.seen(2).beings.get('1')?.equipment.size).toBe(0);
  });

  it('предметы: дельта одного поля; постройки: ревизия в радиусе 32', () => {
    const b = bench();
    b.hero(1, 100, 100);
    b.items.set(500, {
      contentKey: 'item.coin',
      tint: 0,
      amount: 500,
      x: 103,
      y: 100,
      h: 0,
      directionOrLight: 0,
      flags: 0,
      structureId: 0,
      structureRevision: 0,
    });
    b.aoi.upsert({ id: 500, kind: 'item', realm: 'dusk', x: 103, y: 100 });
    b.structures.set(600, {
      contentKey: 'structure.stone-house',
      minX: 130,
      minY: 100,
      maxX: 137,
      maxY: 107,
      h: 0,
      revision: 1,
      flags: 0,
    });
    b.aoi.upsert({
      id: 600,
      kind: 'structure',
      realm: 'dusk',
      x: 130,
      y: 100,
      rect: { minX: 130, minY: 100, maxX: 137, maxY: 107 },
    });
    b.tick();
    expect(b.seen(1).items.get('500')?.amount).toBe(500);
    b.items.set(500, { ...(b.items.get(500) as ItemView), amount: 1_250 });
    b.sync.markDirty(500);
    b.tick();
    expect(b.seen(1).items.get('500')?.amount).toBe(1_250);
    expect(b.clients.get(1)?.bytes).toBeLessThan(16);
    b.structures.set(600, { ...(b.structures.get(600) as StructureView), revision: 2, flags: 1 });
    b.sync.markDirty(600);
    b.tick();
    expect(b.seen(1).structures.get('600')).toMatchObject({ revision: 2, flags: 1 });
  });

  it('содержимое контейнера — только открывшему, включая перестановку', () => {
    const b = bench();
    b.hero(1, 100, 100);
    b.hero(2, 101, 100);
    b.inside.set(700, {
      containerId: 77,
      contentKey: 'item.rye-bread',
      tint: 0,
      amount: 1,
      gridX: 10,
      gridY: 10,
      flags: 0,
    });
    b.aoi.openContainer(1, 77, [700], null);
    b.tick();
    expect(b.seen(1).containerItems.get('700')).toMatchObject({ gridX: 10 });
    expect(b.seen(2).containerItems.size).toBe(0);
    b.inside.set(700, { ...(b.inside.get(700) as ContainerItemView), gridX: 64, gridY: 92 });
    b.sync.markDirty(700);
    b.tick();
    expect(b.seen(1).containerItems.get('700')).toMatchObject({ gridX: 64, gridY: 92 });
    expect(b.seen(2).containerItems.size).toBe(0);
    b.aoi.closeContainer(1, 77);
    b.tick();
    expect(b.seen(1).containerItems.size).toBe(0);
    expect(b.state.containerItems.size).toBe(0);
  });

  it('метаданные партиции всем; хаб без сущностей мира', () => {
    const b = bench();
    b.hero(1, 100, 100);
    b.hero(2, 900, 900);
    b.sync.setMeta({ lightLevel: 40, season: 'light' });
    b.tick();
    b.sync.setMeta({ lightLevel: 46 });
    b.tick();
    expect(b.seen(1).lightLevel).toBe(46);
    expect(b.seen(2).lightLevel).toBe(46);
    expect(b.seen(2).realm).toBe('dusk');
    const hub = new HubState();
    Object.assign(hub, {
      shardId: 'ember',
      shardStatus: 'open',
      onlineCount: 3,
      announcement: 'Добро пожаловать',
    });
    expect(Object.keys(hub.toJSON()).sort()).toEqual([
      'announcement',
      'onlineCount',
      'shardId',
      'shardStatus',
    ]);
  });

  it('отношения по наблюдателю; удаляются при выходе из видимости', () => {
    const rel = new Map<string, Relation>([
      ['2:1', 'ally'],
      ['3:1', 'enemy'],
      ['1:3', 'enemy'],
    ]);
    const b = bench((o, t) => rel.get(`${o}:${t}`) ?? null);
    b.hero(1, 100, 100);
    b.hero(2, 101, 100);
    b.hero(3, 102, 100);
    b.hero(4, 103, 100);
    b.tick();
    expect(b.seen(2).privates.get('2')?.relations.get('1')).toBe('ally');
    expect(b.seen(3).privates.get('3')?.relations.get('1')).toBe('enemy');
    expect(b.seen(4).privates.get('4')?.relations.size).toBe(0);
    expect(b.seen(4).beings.get('1')?.baseReputation).toBe('neutral');
    expect(b.seen(1).privates.get('1')?.relations.get('3')).toBe('enemy');
    b.beings.set(3, being(200, 100));
    b.aoi.move(3, 200, 100);
    b.tick();
    expect(b.seen(1).privates.get('1')?.relations.has('3')).toBe(false);
    expect(b.seen(1).beings.has('3')).toBe(false);
    expect(b.sync.refsOf(3)).toBe(1);
    b.assertNoPrivateDataLeak();
    b.sync.removeClient(2);
    expect(b.state.privates.has('2')).toBe(false);
  });
});
