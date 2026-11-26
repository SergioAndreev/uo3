import { NETCODE_OPCODES, RATE_LIMITS, type HeroState } from '@duskmarch/protocol';
import type { AccessLevel } from '@duskmarch/domain';
import { describe, expect, it } from 'vitest';
import { Scheduler } from '../engine/scheduler.js';
import { negotiate } from './handshake.js';
import { IntentRouter, NetSession, type IntentHandler } from './router.js';

const HEX = 'a'.repeat(64);
const WORLD = 'b'.repeat(64);
const hello = (over: Record<string, unknown> = {}) => ({
  protocolVersion: '1.0.0',
  rulesetFingerprint: HEX,
  worldVersion: WORLD,
  ...over,
});

function bench(
  opts: { room?: 'world' | 'hub'; version?: [string, string]; patchIds?: string[] } = {},
) {
  let now = 0;
  const scheduler = new Scheduler({ perfNow: () => 0 });
  const logs: unknown[] = [];
  const router = new IntentRouter({
    room: opts.room ?? 'world',
    handshake: {
      protocolVersion: opts.version?.[0] ?? '1.3.0',
      minSupportedProtocolVersion: opts.version?.[1] ?? '1.0.0',
      rulesetFingerprint: HEX,
      ruleset: { profileVersion: 2 },
      worldVersion: WORLD,
      patchIds: opts.patchIds ?? [],
      tickIntervalMs: 50,
      clock: () => ({ tick: scheduler.tick, timeMs: scheduler.timeMs }),
    },
    enqueue: (item) => scheduler.enqueue(item),
    tick: () => scheduler.tick,
    now: () => now,
    log: (...args) => logs.push(args),
  });
  let order = 0;
  const open = (
    level: AccessLevel = 'player',
    state: HeroState = 'alive',
    limits = RATE_LIMITS,
  ) => {
    const sent: { opcode: number; payload: Record<string, unknown> }[] = [];
    const closed: number[] = [];
    const audit: string[] = [];
    const denied: number[] = [];
    const session = new NetSession(
      order++,
      {
        send: (opcode, payload) =>
          sent.push({ opcode, payload: payload as Record<string, unknown> }),
        close: (code) => closed.push(code),
        accessLevel: () => level,
        heroState: () => state,
        walkDeny: (seq) => denied.push(seq),
        audit: (e) => audit.push(e),
      },
      now,
      limits,
    );
    const errors = () =>
      sent.filter((m) => m.opcode === NETCODE_OPCODES['cmd.error']).map((m) => m.payload);
    const recv = (opcode: number, payload: unknown, bytes = 64) =>
      router.receive(session, opcode, payload, bytes);
    return { session, sent, closed, audit, denied, errors, recv };
  };
  const active = (level?: AccessLevel, state?: HeroState, limits = RATE_LIMITS) => {
    const c = open(level, state, limits);
    c.recv(NETCODE_OPCODES['session.hello'], hello());
    return c;
  };
  return { router, scheduler, open, active, logs, wait: (ms: number) => (now += ms) };
}

describe('netcode/command-protocol: версии и рукопожатие', () => {
  it('согласование версий', () => {
    expect(negotiate('1.2.4', '1.3.0', '1.0.0')).toBe('1.2.4');
    expect(negotiate('1.9.0', '2.0.0', '2.0.0')).toBeNull();
    expect(negotiate('1.1.9', '1.3.0', '1.2.0')).toBeNull();
    expect(negotiate('1.4.0', '1.3.0', '1.0.0')).toBeNull();
    expect(negotiate('x', '1.3.0', '1.0.0')).toBeNull();
  });

  it('welcome с согласованной версией, правилами, миром и тиком', () => {
    const b = bench();
    const c = b.open();
    c.recv(NETCODE_OPCODES['session.hello'], hello({ protocolVersion: '1.2.4' }));
    expect(c.session.state).toBe('active');
    expect(c.sent[0]).toMatchObject({
      opcode: NETCODE_OPCODES['session.welcome'],
      payload: {
        negotiatedProtocolVersion: '1.2.4',
        compatibility: 'OK',
        rulesetFingerprint: HEX,
        worldVersion: WORLD,
        serverTick: 0,
        ruleset: { profileVersion: 2 },
      },
    });
  });

  it('несовместимая версия — PROTO_VERSION_UNSUPPORTED и 4111', () => {
    const b = bench({ version: ['2.0.0', '2.0.0'] });
    const c = b.open();
    c.recv(NETCODE_OPCODES['session.hello'], hello({ protocolVersion: '1.9.0' }));
    expect(c.errors()[0]).toMatchObject({
      error: 'PROTO_VERSION_UNSUPPORTED',
      details: { serverVersion: '2.0.0', minSupportedVersion: '2.0.0', updateRequired: true },
    });
    expect(c.closed).toEqual([4111]);
    const low = bench({ version: ['1.3.0', '1.2.0'] }).open();
    low.recv(NETCODE_OPCODES['session.hello'], hello({ protocolVersion: '1.1.9' }));
    expect(low.closed).toEqual([4111]);
  });

  it('недостающие патчи — PATCH_DIFF_WARNING; другой мир — 4107', () => {
    const b = bench({ patchIds: ['bridge-2026-11', 'gate-ember'] });
    const c = b.open();
    c.recv(NETCODE_OPCODES['session.hello'], hello({ patchIds: ['gate-ember'] }));
    expect(c.sent[0]?.payload).toMatchObject({
      compatibility: 'PATCH_DIFF_WARNING',
      missingPatchIds: ['bridge-2026-11'],
    });
    const bad = b.open();
    bad.recv(NETCODE_OPCODES['session.hello'], hello({ worldVersion: 'c'.repeat(64) }));
    expect(bad.errors()[0]).toMatchObject({
      error: 'PROTO_WORLD_DATA_INCOMPATIBLE',
      details: { expectedWorldVersion: WORLD },
    });
    expect(bad.closed).toEqual([4107]);
    const broken = b.open();
    broken.recv(NETCODE_OPCODES['session.hello'], { protocolVersion: '1.0.0' });
    expect(broken.closed).toEqual([4100]);
  });

  it('намерение до рукопожатия — PROTO_HANDSHAKE_REQUIRED; тишина 5 с — 4129; 30 с — 4131', () => {
    const b = bench();
    const c = b.open();
    c.recv(0x0100, { seq: 1, direction: 2 });
    expect(c.errors()[0]).toMatchObject({ error: 'PROTO_HANDSHAKE_REQUIRED' });
    b.wait(4_999);
    b.router.checkTimeouts(c.session);
    expect(c.closed).toEqual([]);
    b.wait(1);
    b.router.checkTimeouts(c.session);
    expect(c.closed).toEqual([4129]);
    expect(c.errors().at(-1)).toMatchObject({ error: 'PROTO_HANDSHAKE_TIMEOUT' });
    const a = b.active();
    b.wait(29_999);
    b.router.checkTimeouts(a.session);
    expect(a.closed).toEqual([]);
    b.wait(1);
    b.router.checkTimeouts(a.session);
    expect(a.closed).toEqual([4131]);
    a.recv(0x0126, { targetId: 1 });
    expect(a.errors().at(-1)).toMatchObject({ error: 'NET_HEARTBEAT_TIMEOUT' });
  });
});

describe('netcode/command-protocol: приём намерений', () => {
  const noop: IntentHandler = () => undefined;

  it('ошибки протокола считаются; 20 за 10 с — PROTO_MALFORMED_FLOOD и 4100', () => {
    const b = bench();
    const c = b.active();
    c.recv(0x9999, {});
    expect(c.errors()[0]).toMatchObject({
      error: 'PROTO_UNKNOWN_OPCODE',
      opcode: 0x9999,
      retryable: false,
    });
    c.recv(0x0126, { targetId: 5, forceOpen: true, requestId: 9 });
    expect(c.errors()[1]).toMatchObject({
      error: 'PROTO_INVALID_PAYLOAD',
      requestId: 9,
      details: { paths: expect.any(Array) },
    });
    c.recv(0x0126, { targetId: 5 }, 24_576);
    expect(c.errors()[2]).toMatchObject({ error: 'PROTO_FRAME_TOO_LARGE' });
    c.recv(0x02f0, { channel: 'общий', text: 'привет' });
    expect(c.errors()[3]).toMatchObject({ error: 'PROTO_WRONG_ROOM_TYPE' });
    expect(c.session.violations).toBe(4);
    b.wait(11_000);
    for (let i = 0; i < 18; i++) c.recv(0x9999, {});
    expect(c.closed).toEqual([]);
    c.recv(0x9999, {});
    expect(c.closed).toEqual([]);
    c.recv(0x9999, {});
    expect(c.closed).toEqual([4100]);
    expect(c.errors().at(-1)).toMatchObject({ error: 'PROTO_MALFORMED_FLOOD' });
    c.recv(0x9999, {});
    expect(c.closed).toEqual([4100]);
  });

  it('права, состояние героя, обработчик недоступен', () => {
    const b = bench();
    b.router.handle('staff.command', noop);
    b.router.handle('item.pick_up', noop);
    const p = b.active('player');
    p.recv(0x0360, { command: 'go', args: [] });
    expect(p.errors()[0]).toMatchObject({ error: 'CMD_FORBIDDEN_ACCESS_LEVEL' });
    expect(p.audit).toContain('access.denied');
    const gm = b.active('game-master');
    gm.recv(0x0360, { command: 'go', args: [] });
    expect(gm.errors()).toEqual([]);
    expect(b.scheduler.ingressLength).toBe(1);
    const fallen = b.active('player', 'fallen');
    fallen.recv(0x0120, { targetId: 3 });
    expect(fallen.errors()[0]).toMatchObject({ error: 'CMD_INVALID_ENTITY_STATE' });
    fallen.recv(0x01f0, { tones: ['heat', 'light'] });
    expect(fallen.errors()[1]).toMatchObject({ error: 'CMD_INVALID_ENTITY_STATE' });
    p.recv(0x01f0, { tones: ['heat', 'light'] });
    expect(p.errors().at(-1)).toMatchObject({ error: 'CMD_HANDLER_UNAVAILABLE', retryable: false });
    expect(() => b.router.handle('nope.none', noop)).toThrow('не в каталоге');
  });

  it('ошибка обработчика: requestId; исключение — CMD_INTERNAL_ERROR без подробностей', () => {
    const b = bench();
    b.router.handle('world.inspect', () => ({ error: 'CMD_TARGET_NOT_FOUND' }));
    b.router.handle('world.use', () => {
      throw new Error('SELECT * FROM items');
    });
    const c = b.active();
    c.recv(0x0125, { targetId: 77, requestId: 771 });
    c.recv(0x0126, { targetId: 77, requestId: 772 });
    b.scheduler.advance();
    expect(c.errors()[0]).toEqual({
      requestId: 771,
      opcode: 0x0125,
      error: 'CMD_TARGET_NOT_FOUND',
      code: 2008,
      retryable: false,
    });
    expect(c.errors()[1]).toEqual({
      requestId: 772,
      opcode: 0x0126,
      error: 'CMD_INTERNAL_ERROR',
      code: 2006,
      retryable: true,
    });
    expect(JSON.stringify(c.errors())).not.toContain('SELECT');
    expect(b.logs).toHaveLength(1);
  });

  it('частота: 15 из 16 за 500 мс, retryAfterMs; 50 отказов за 10 с — 4108', () => {
    const b = bench();
    b.router.handle('world.inspect', noop);
    const c = b.active();
    for (let i = 0; i < 16; i++) {
      c.recv(0x0125, { targetId: 1 });
      if (i % 10 === 9) b.scheduler.advance();
    }
    const limited = c.errors().filter((e) => e.error === 'CMD_RATE_LIMITED');
    expect(limited).toHaveLength(1);
    expect(limited[0]?.retryAfterMs).toBeGreaterThan(0);
    expect(c.closed).toEqual([]);
    for (let i = 0; i < 48; i++) c.recv(0x0125, { targetId: 1 });
    expect(c.closed).toEqual([]);
    c.recv(0x0125, { targetId: 1 });
    expect(c.closed).toEqual([4108]);
    expect(c.errors().at(-1)).toMatchObject({ error: 'PROTO_RATE_LIMIT_EXCEEDED' });
  });

  it('окно шагов 4 и отказ шага; порядок seq сохраняется', () => {
    const b = bench();
    const seen: number[] = [];
    b.router.handle('move.walk_req', (_s, v: { seq: number }) => {
      seen.push(v.seq);
    });
    const c = b.active();
    c.recv(0x0100, { seq: 40, direction: 2 });
    c.recv(0x0100, { seq: 41, direction: 2 });
    c.recv(0x0100, { seq: 42, direction: 0x82 });
    c.recv(0x0100, { seq: 43, direction: 2 });
    c.recv(0x0100, { seq: 44, direction: 2 });
    expect(c.errors()[0]).toMatchObject({ error: 'CMD_WALK_WINDOW_EXCEEDED' });
    expect(c.denied).toEqual([44]);
    b.scheduler.advance();
    expect(seen).toEqual([40, 41, 42, 43]);
    c.session.ackSteps(4);
    c.recv(0x0100, { seq: 44, direction: 2 });
    expect(c.errors()).toHaveLength(1);
  });

  it('очередь 32 на тик; детерминированный порядок двух сессий', () => {
    const b = bench();
    const order: string[] = [];
    b.router.handle('staff.command', (s, v: { command: string }) => {
      order.push(`${s.sessionOrder}:${v.command}`);
    });
    const wide = { ...RATE_LIMITS, staff: { perSecond: 1_000, burst: 1_000 } };
    const a = b.active('owner', 'alive', wide);
    const c = b.active('owner', 'alive', wide);
    for (let i = 0; i < 33; i++) a.recv(0x0360, { command: `a${i}`, args: [] });
    expect(a.errors().filter((e) => e.error === 'CMD_QUEUE_OVERFLOW')).toHaveLength(1);
    c.recv(0x0360, { command: 'c0', args: [] });
    a.recv(0x0360, { command: 'late', args: [] });
    b.scheduler.advance();
    expect(order.slice(0, 2)).toEqual(['0:a0', '0:a1']);
    expect(order).toHaveLength(33);
    expect(order.at(-1)).toBe('1:c0');
    expect(order).not.toContain('0:a32');
  });

  it('хаб: намерение мира — PROTO_WRONG_ROOM_TYPE; повторный hello — нарушение', () => {
    const b = bench({ room: 'hub' });
    const c = b.active();
    c.recv(0x0100, { seq: 1, direction: 1 });
    expect(c.errors()[0]).toMatchObject({ error: 'PROTO_WRONG_ROOM_TYPE' });
    c.recv(NETCODE_OPCODES['session.hello'], hello());
    expect(c.errors()[1]).toMatchObject({ error: 'PROTO_INVALID_PAYLOAD' });
  });
});
