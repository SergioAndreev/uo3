import { NETCODE_OPCODES, RATE_LIMITS } from '@duskmarch/protocol';
import { describe, expect, it } from 'vitest';
import { Scheduler } from '../engine/scheduler.js';
import { IntentRouter, NetSession } from './router.js';
import { ServerRtt, answerPing } from './time-sync.js';

const HEX = 'a'.repeat(64);

function bench() {
  let now = 1_000;
  let perf = 0;
  const scheduler = new Scheduler({ perfNow: () => perf });
  const router = new IntentRouter({
    room: 'world',
    handshake: {
      protocolVersion: '1.0.0',
      minSupportedProtocolVersion: '1.0.0',
      rulesetFingerprint: HEX,
      ruleset: {},
      worldVersion: HEX,
      patchIds: [],
      tickIntervalMs: 50,
      clock: () => ({ tick: scheduler.tick, timeMs: scheduler.timeMs }),
    },
    enqueue: (item) => scheduler.enqueue(item),
    tick: () => scheduler.tick,
    now: () => now,
    tickStats: () => ({
      tick: scheduler.tick,
      tickStartMs: scheduler.lastTickStartedMs,
      tickIntervalMs: 50,
      loadPct: 92.4,
      overrun: true,
    }),
  });
  const sent: { opcode: number; payload: Record<string, unknown> }[] = [];
  const closed: number[] = [];
  const session = new NetSession(
    0,
    {
      send: (opcode, payload) => sent.push({ opcode, payload: payload as Record<string, unknown> }),
      close: (c) => closed.push(c),
      accessLevel: () => 'player',
      heroState: () => 'alive',
    },
    now,
    RATE_LIMITS,
  );
  router.receive(
    session,
    NETCODE_OPCODES['session.hello'],
    { protocolVersion: '1.0.0', rulesetFingerprint: HEX, worldVersion: HEX },
    100,
  );
  return {
    router,
    session,
    sent,
    closed,
    scheduler,
    advance: (ms: number) => {
      now += ms;
      perf += ms;
    },
    ping: (seq: number, clientSendMs = 5) =>
      router.receive(session, NETCODE_OPCODES['time.ping'], { seq, clientSendMs }, 32),
  };
}

describe('netcode/time-sync-and-latency: сервер', () => {
  it('pong сразу, вне тика, с метками, тиком и нагрузкой', () => {
    const b = bench();
    b.scheduler.advance(3);
    b.advance(10);
    const queued = b.scheduler.ingressLength;
    b.ping(1);
    expect(b.scheduler.ingressLength).toBe(queued);
    const pong = b.sent.find((m) => m.opcode === NETCODE_OPCODES['time.pong'])?.payload;
    expect(pong).toMatchObject({
      seq: 1,
      clientSendMs: 5,
      serverRecvMs: 1_010,
      serverSendMs: 1_010,
      serverTick: 3,
      tickIntervalMs: 50,
      serverTickLoadPct: 92,
      serverTickOverrun: true,
    });
    expect(pong?.serverSendMs as number).toBeGreaterThanOrEqual(pong?.serverRecvMs as number);
  });

  it('отрицательный clientSendMs — PROTO_INVALID_PAYLOAD; частота выше 2/с после всплеска 6 — CMD_RATE_LIMITED', () => {
    const b = bench();
    b.ping(1, -5);
    expect(b.sent.at(-1)).toMatchObject({
      opcode: NETCODE_OPCODES['cmd.error'],
      payload: { error: 'PROTO_INVALID_PAYLOAD' },
    });
    for (let i = 0; i < 6; i++) b.ping(10 + i);
    const pongs = () => b.sent.filter((m) => m.opcode === NETCODE_OPCODES['time.pong']).length;
    expect(pongs()).toBe(6);
    b.ping(99);
    expect(pongs()).toBe(6);
    expect(b.sent.at(-1)?.payload).toMatchObject({ error: 'CMD_RATE_LIMITED' });
    b.advance(500);
    b.ping(100);
    expect(pongs()).toBe(7);
  });

  it('зонды держат сессию живой; 30 с тишины — 4131', () => {
    const b = bench();
    for (let i = 0; i < 20; i++) {
      b.advance(2_000);
      b.ping(i);
      b.router.checkTimeouts(b.session);
    }
    expect(b.closed).toEqual([]);
    b.advance(30_000);
    b.router.checkTimeouts(b.session);
    expect(b.closed).toEqual([4131]);
  });

  it('RTT сессии — только по серверным меткам, потолок 500 мс', () => {
    const rtt = new ServerRtt();
    expect(rtt.probeReplied(10)).toBeNull();
    rtt.probeSent(0);
    rtt.probeSent(5);
    expect(rtt.probeReplied(40)).toBe(40);
    rtt.probeSent(1_000);
    expect(rtt.probeReplied(9_000)).toBe(500);
    expect(rtt.sessionRttMs).toBeLessThanOrEqual(500);
    expect(rtt.sessionJitterMs).toBeGreaterThan(0);
    const forged = answerPing(
      { seq: 1, clientSendMs: 1e12 },
      100,
      { tick: 0, tickStartMs: 0, tickIntervalMs: 50, loadPct: 400, overrun: false },
      () => 101,
    );
    expect(forged.ok && forged.pong.serverTickLoadPct).toBe(255);
  });
});
