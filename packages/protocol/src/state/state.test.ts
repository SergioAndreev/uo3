import { Decoder, Encoder, StateView } from '@colyseus/schema';
import { describe, expect, it } from 'vitest';
import { PartitionState, PrivateHeroState, ReplicatedBeing, ReplicatedItem } from './index.js';

function hero(id: number, name: string) {
  const b = new ReplicatedBeing();
  Object.assign(b, {
    entityId: id,
    kind: 'hero',
    name,
    model: 'hero.frame-humanoid',
    tint: 9,
    x: 100,
    y: 100,
    h: 0,
    direction: 2,
    baseReputation: 'neutral',
    healthPercent: 87,
  });
  return b;
}

/** Кодирование как в SchemaSerializer Colyseus: общий буфер, затем часть просмотра. */
function viewBytes(encoder: Encoder, view: StateView, full: boolean): Uint8Array {
  const buffer = Buffer.alloc(64 * 1024);
  const it = { offset: 0 };
  if (full) {
    encoder.encodeAll(it, buffer);
    return Uint8Array.from(encoder.encodeAllView(view, it.offset, { ...it }, buffer));
  }
  encoder.encode(it, undefined, buffer);
  const bytes = Uint8Array.from(encoder.encodeView(view, it.offset, it, buffer));
  encoder.discardChanges();
  return bytes;
}

/** Полное кодирование для просмотра и декодирование в новое состояние. */
function decodeFor(encoder: Encoder, view: StateView): PartitionState {
  const state = new PartitionState();
  new Decoder(state).decode(viewBytes(encoder, view, true));
  return state;
}

describe('состояние партиции', () => {
  it('StateView: чужой видит публичную проекцию, но не приватное состояние', () => {
    const state = new PartitionState();
    Object.assign(state, {
      shardId: 'ember',
      partitionId: 'dawn-0',
      realm: 'dawn',
      lightLevel: 40,
      season: 'light',
    });
    const a = hero(1, 'Ясна');
    const b = hero(2, 'Ива');
    state.beings.set('1', a);
    state.beings.set('2', b);
    const privA = new PrivateHeroState();
    Object.assign(privA, {
      entityId: 1,
      might: 60,
      health: 87,
      maxHealth: 100,
      money: 15_400,
      weightKg: 210,
    });
    privA.relations.set('2', 'ally');
    state.privates.set('1', privA);
    const encoder = new Encoder(state);
    const viewA = new StateView();
    viewA.add(a);
    viewA.add(b);
    viewA.add(privA);
    const viewB = new StateView();
    viewB.add(a);
    viewB.add(b);
    const forA = decodeFor(encoder, viewA);
    const forB = decodeFor(encoder, viewB);
    expect(forA.privates.get('1')?.money).toBe(15_400);
    expect(forA.privates.get('1')?.relations.get('2')).toBe('ally');
    expect(forB.privates.size).toBe(0);
    expect(forB.beings.get('1')).toMatchObject({ name: 'Ясна', healthPercent: 87 });
    expect(forB.realm).toBe('dawn');
  });

  it('размер: полный снимок и дельта одного поля', () => {
    const state = new PartitionState();
    const items = Array.from({ length: 50 }, (_, i) => {
      const it = new ReplicatedItem();
      Object.assign(it, {
        entityId: 1_610_612_737 + i,
        contentKey: 'item.rye-bread',
        amount: 3,
        x: i,
        y: 5,
      });
      state.items.set(String(i), it);
      return it;
    });
    const encoder = new Encoder(state);
    const view = new StateView();
    for (const it of items) view.add(it);
    expect(viewBytes(encoder, view, true).byteLength).toBeLessThan(2_500);
    viewBytes(encoder, view, false);
    (items[3] as ReplicatedItem).amount = 1_250;
    expect(viewBytes(encoder, view, false).byteLength).toBeLessThan(32);
  });
});
