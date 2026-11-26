import { Decoder, Encoder, StateView } from '@colyseus/schema';
import type { EntityId } from '@duskmarch/domain';
import { PartitionState } from '@duskmarch/protocol/state';
import { describe, expect, it } from 'vitest';
import { EventChannel, HARD_BUFFER_BYTES } from './events.js';
import { InterestManager, type Observer } from './interest.js';
import { ProjectionSync, type BeingView } from './projection.js';
import { ReplicationScheduler, priorityOf } from './replication.js';

const beingView = (x: number, y: number, healthPercent = 100): BeingView => ({
  kind: 'creature',
  name: 'Песчаный бегун',
  model: 'creature.dune-strider',
  tint: 0,
  x,
  y,
  h: 0,
  direction: 0,
  baseReputation: 'neutral',
  statusFlags: 0,
  healthPercent,
  mountModel: '',
  mountTint: 0,
  equipment: {},
});

function world() {
  const aoi = new InterestManager({ radius: 20, largeRadius: 32 });
  const observe = (id: EntityId, x: number, y: number): Observer => {
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
    return o;
  };
  return { aoi, observe };
}

describe('netcode/state-replication: приоритеты и бюджет', () => {
  it('классификация P0..P3', () => {
    expect(priorityOf('being', 0, true, false)).toBe(0);
    expect(priorityOf('being', 6, false, false)).toBe(1);
    expect(priorityOf('being', 16, false, true)).toBe(1);
    expect(priorityOf('being', 16, false, false)).toBe(2);
    expect(priorityOf('being', 21, false, false)).toBe(3);
    expect(priorityOf('item', 10, false, false)).toBe(2);
    expect(priorityOf('item', 17, false, false)).toBe(3);
    expect(priorityOf('structure', 5, false, false)).toBe(3);
  });

  it('частоты: P0/P1 — 20 Гц, P2 — 10 Гц, P3 — 4 Гц; при перегрузке P3 → 2 Гц, P2 → 5 Гц, P0 без изменений', () => {
    const { aoi, observe } = world();
    observe(1, 100, 100);
    aoi.upsert({ id: 2, kind: 'being', realm: 'dusk', x: 106, y: 100 });
    aoi.upsert({ id: 3, kind: 'being', realm: 'dusk', x: 116, y: 100 });
    aoi.upsert({ id: 4, kind: 'item', realm: 'dusk', x: 117, y: 100 });
    aoi.flush();
    const sched = new ReplicationScheduler(aoi, { starvationMs: 10_000 });
    sched.addClient(1, 0);
    const count = (ticks: number) => {
      const sent = new Map<EntityId, number>();
      for (let t = 0; t < ticks; t++) {
        for (const id of [1, 2, 3, 4]) {
          sched.touched(id, tick);
          if (sched.due(id, tick)) sent.set(id, (sent.get(id) ?? 0) + 1);
        }
        tick++;
      }
      return sent;
    };
    let tick = 0;
    expect(Object.fromEntries(count(20))).toEqual({ 1: 20, 2: 20, 3: 10, 4: 4 });
    for (let s = 1; s <= 2; s++) sched.record(1, 40_000, s * 1_000 + 3_000);
    expect(sched.levelOf(1)).toBe(2);
    const degraded = count(20);
    expect(degraded.get(1)).toBe(20);
    expect(degraded.get(4)).toBe(2);
    expect(degraded.get(3)).toBe(5);
    expect(sched.metrics().deferred[3]).toBeGreaterThan(0);
  });

  it('голодание: отложенное обновление уходит не позже 500 мс', () => {
    const { aoi, observe } = world();
    observe(1, 100, 100);
    aoi.upsert({ id: 4, kind: 'item', realm: 'dusk', x: 117, y: 100 });
    aoi.flush();
    const sched = new ReplicationScheduler(aoi);
    sched.addClient(1, 0);
    for (let s = 1; s <= 6; s++) sched.record(1, 80_000, s * 1_000 + 3_000);
    expect(sched.levelOf(1)).toBe(3);
    expect(sched.due(4, 0)).toBe(true);
    sched.touched(4, 1);
    let sentAt = -1;
    for (let t = 1; t < 30 && sentAt < 0; t++) if (sched.due(4, t)) sentAt = t;
    expect((sentAt - 1 + 1) * 50).toBeLessThanOrEqual(500);
    sched.forget(4);
  });

  it('коалесценция: 100→85→72→80 — одно значение; запись тех же значений — пустая дельта', () => {
    const { aoi, observe } = world();
    observe(1, 100, 100);
    const views = new Map<EntityId, BeingView>([
      [1, beingView(100, 100)],
      [2, beingView(103, 100)],
    ]);
    aoi.upsert({ id: 2, kind: 'being', realm: 'dusk', x: 103, y: 100 });
    const state = new PartitionState();
    const sync = new ProjectionSync(state, {
      being: (id) => views.get(id),
      item: () => undefined,
      structure: () => undefined,
      containerItem: () => undefined,
      privateOf: () => undefined,
    });
    const view = new StateView();
    sync.addClient(1, view);
    const encoder = new Encoder(state);
    const decoded = new PartitionState();
    const decoder = new Decoder(decoded);
    const buffer = Buffer.alloc(64 * 1024);
    const patch = () => {
      for (const [id, diff] of aoi.flush()) sync.apply(id, diff);
      sync.flush();
      const it = { offset: 0 };
      encoder.encode(it, undefined, buffer);
      const shared = it.offset;
      const bytes = encoder.encodeView(view, shared, it, buffer);
      decoder.decode(Uint8Array.from(bytes));
      encoder.discardChanges();
      return bytes.byteLength;
    };
    patch();
    for (const hp of [85, 72, 80]) {
      views.set(2, beingView(103, 100, hp));
      sync.markDirty(2);
    }
    patch();
    expect(decoded.beings.get('2')?.healthPercent).toBe(80);
    sync.markDirty(2);
    expect(patch()).toBeLessThanOrEqual(1);
  });

  it('100 существ двигаются 10 с: средний трафик ≤ 16 КиБ/с без разрыва', () => {
    const { aoi, observe } = world();
    observe(1, 500, 500);
    const views = new Map<EntityId, BeingView>([[1, beingView(500, 500)]]);
    for (let i = 0; i < 100; i++) {
      const id = 10 + i;
      const x = 482 + (i % 37);
      const y = 482 + Math.floor(i / 37) * 9;
      views.set(id, beingView(x, y));
      aoi.upsert({ id, kind: 'being', realm: 'dusk', x, y });
    }
    const state = new PartitionState();
    const sync = new ProjectionSync(state, {
      being: (id) => views.get(id),
      item: () => undefined,
      structure: () => undefined,
      containerItem: () => undefined,
      privateOf: () => undefined,
    });
    const view = new StateView();
    sync.addClient(1, view);
    const sched = new ReplicationScheduler(aoi);
    sched.addClient(1, 0);
    const encoder = new Encoder(state);
    const buffer = Buffer.alloc(256 * 1024);
    let total = 0;
    for (let tick = 0; tick < 200; tick++) {
      const now = tick * 50;
      for (let i = 0; i < 100; i++) {
        const id = 10 + i;
        const v = views.get(id) as BeingView;
        const dx = (tick + i) % 4 < 2 ? 1 : -1;
        views.set(id, { ...v, x: v.x + dx, direction: dx > 0 ? 2 : 6 });
        aoi.move(id, v.x + dx, v.y);
        sync.markDirty(id);
        sched.touched(id, tick);
      }
      for (const [id, diff] of aoi.flush()) sync.apply(id, diff);
      sync.flush((id) => sched.due(id, tick));
      const it = { offset: 0 };
      encoder.encode(it, undefined, buffer);
      const shared = it.offset;
      const bytes = encoder.encodeView(view, shared, it, buffer).byteLength;
      encoder.discardChanges();
      total += bytes;
      sched.record(1, bytes, now);
      sched.recordEncode(0.1);
    }
    expect(total / 10).toBeLessThanOrEqual(16 * 1024);
    expect(sched.metrics()).toMatchObject({ bytesSent: total, patches: 200 });
  });
});

describe('netcode/state-replication: немедленные события', () => {
  function channel() {
    const { aoi, observe } = world();
    const sent: {
      client: EntityId;
      opcode: number;
      payload: { events?: { type: string }[]; error?: string };
    }[] = [];
    const closed: [EntityId, number][] = [];
    const buffered = new Map<EntityId, number>();
    const events = new EventChannel(aoi, {
      send: (client, opcode, payload) => sent.push({ client, opcode, payload: payload as never }),
      buffered: (client) => buffered.get(client) ?? 0,
      close: (client, code) => closed.push([client, code]),
    });
    return { aoi, observe, events, sent, closed, buffered };
  }

  it('речь по дальностям 2/14/24: 30 клеток — ничего', () => {
    const c = channel();
    c.observe(1, 100, 100);
    c.observe(2, 102, 100);
    c.observe(3, 110, 100);
    c.observe(4, 116, 100);
    c.observe(5, 130, 100);
    c.aoi.flush();
    expect(c.events.near(1, 2, { type: 'speech', mode: 'whisper' })).toEqual([1, 2]);
    expect(c.events.near(1, 14, { type: 'speech', mode: 'normal' })).toEqual([1, 2, 3]);
    expect(c.events.near(1, 24, { type: 'speech', mode: 'shout' })).toEqual([1, 2, 3, 4]);
    c.events.endTick([1, 2, 3, 4, 5], 0);
    expect(c.sent.filter((m) => m.client === 5)).toEqual([]);
    expect(c.sent.find((m) => m.client === 4)?.payload.events).toEqual([
      { type: 'speech', mode: 'shout' },
    ]);
  });

  it('скрытый источник: посторонний не получает событие; подтверждение шага — сразу', () => {
    const c = channel();
    c.observe(1, 100, 100);
    c.observe(2, 103, 100);
    c.aoi.flush();
    c.aoi.touch(1, { concealLevel: 'player' });
    c.aoi.flush();
    expect(c.events.near(1, 14, { type: 'visual_effect' })).toEqual([1]);
    c.events.to(1, { type: 'walk_ack', seq: 42 });
    expect(c.sent.at(-1)).toMatchObject({
      client: 1,
      payload: { events: [{ type: 'walk_ack', seq: 42 }] },
    });
  });

  it('обратное давление: выше 64 КиБ косметика отбрасывается; 256 КиБ 5 с или 512 КиБ — 4130', () => {
    const c = channel();
    c.observe(1, 100, 100);
    c.observe(2, 101, 100);
    c.aoi.flush();
    c.buffered.set(1, 80_000);
    c.events.to(1, { type: 'sound_effect' }, false);
    c.events.to(1, { type: 'walk_deny', seq: 3 });
    expect(c.events.dropped).toBe(1);
    expect(c.sent.map((m) => m.payload.events?.[0]?.type)).toEqual(['walk_deny']);
    c.buffered.set(1, HARD_BUFFER_BYTES + 1);
    expect(c.events.endTick([1, 2], 0)).toEqual([]);
    expect(c.events.endTick([1, 2], 4_999)).toEqual([]);
    expect(c.events.endTick([1, 2], 5_000)).toEqual([1]);
    expect(c.closed).toEqual([[1, 4130]]);
    expect(c.sent.at(-1)?.payload.error).toBe('NET_SLOW_CONSUMER');
    c.buffered.set(2, 600_000);
    expect(c.events.endTick([2], 6_000)).toEqual([2]);
  });
});
