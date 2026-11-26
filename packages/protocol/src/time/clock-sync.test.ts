import { describe, expect, it } from 'vitest';
import { ClockSync, LinkQuality, classify, type ClockEvent } from './clock-sync.js';

/** Синтетический канал: часы клиента, смещение сервера, RTT. */
function link(offset: number, opts: { overrun?: boolean; loadPct?: number } = {}) {
  let now = 1_000;
  const events: ClockEvent[] = [];
  const sync = new ClockSync({ now: () => now, onEvent: (e) => events.push(e) });
  const exchange = (rtt: number) => {
    const ping = sync.ping();
    now += rtt / 2;
    const server = now + offset;
    const pong = {
      seq: ping.seq,
      clientSendMs: ping.clientSendMs,
      serverRecvMs: server,
      serverSendMs: server,
      serverTick: Math.floor(server / 50),
      serverTickStartMs: Math.floor(server / 50) * 50,
      tickIntervalMs: 50,
      serverTickLoadPct: opts.loadPct ?? 30,
      serverTickOverrun: opts.overrun ?? false,
    };
    now += rtt / 2;
    return sync.onPong(pong);
  };
  const wait = (ms: number) => {
    now += ms;
  };
  return {
    sync,
    events,
    exchange,
    wait,
    now: () => now,
    setOverrun: (v: boolean) => (opts.overrun = v),
  };
}

describe('netcode/time-sync-and-latency: клиент', () => {
  it('калибровка: 5 зондов по 200 мс, смещение сходится к 420 ± 15 мс', () => {
    const l = link(420);
    for (let i = 0; i < 5; i++) {
      expect(l.sync.nextDelayMs()).toBe(200);
      l.exchange(60);
      l.wait(140);
    }
    expect(Math.abs(l.sync.clockOffsetMs - 420)).toBeLessThanOrEqual(15);
    expect(l.sync.connectionState).toBe('connected');
    expect(l.sync.nextDelayMs()).toBe(2_000);
    expect(l.sync.rttMs).toBe(60);
  });

  it('период: 5 000 мс после 30 с хорошей связи; 1 000 мс при плохой', () => {
    const l = link(0);
    for (let i = 0; i < 5; i++) l.exchange(20);
    for (let t = 0; t < 32; t += 2) {
      l.wait(2_000);
      l.exchange(20);
    }
    expect(l.sync.nextDelayMs()).toBe(5_000);
    for (let i = 0; i < 10; i++) l.exchange(400);
    expect(['poor', 'critical']).toContain(l.sync.qualityLevel);
    expect(l.sync.nextDelayMs()).toBe(1_000);
  });

  it('выброс RTT отсеивается из смещения; чужой seq отбрасывается', () => {
    const l = link(100);
    for (let i = 0; i < 7; i++) l.exchange(40 + (i % 5));
    const before = l.sync.clockOffsetMs;
    const ping = l.sync.ping();
    l.wait(190);
    const server = l.now() + 100 + 150;
    l.wait(190);
    l.sync.onPong({
      seq: ping.seq,
      clientSendMs: ping.clientSendMs,
      serverRecvMs: server,
      serverSendMs: server,
      serverTick: 0,
      serverTickStartMs: 0,
      tickIntervalMs: 50,
      serverTickLoadPct: 0,
      serverTickOverrun: false,
    });
    expect(Math.abs(l.sync.clockOffsetMs - before)).toBeLessThanOrEqual(5);
    const snap = l.sync.snapshot();
    expect(
      l.sync.onPong({
        seq: 9_999,
        clientSendMs: 0,
        serverRecvMs: 0,
        serverSendMs: 0,
        serverTick: 0,
        serverTickStartMs: 0,
        tickIntervalMs: 50,
        serverTickLoadPct: 0,
        serverTickOverrun: false,
      }),
    ).toBe(false);
    expect(
      l.sync.onPong({
        seq: ping.seq,
        clientSendMs: ping.clientSendMs,
        serverRecvMs: 0,
        serverSendMs: 0,
        serverTick: 0,
        serverTickStartMs: 0,
        tickIntervalMs: 50,
        serverTickLoadPct: 0,
        serverTickOverrun: false,
      }),
    ).toBe(false);
    expect(l.sync.snapshot()).toMatchObject({
      smoothedRttMs: snap.smoothedRttMs,
      jitterMs: snap.jitterMs,
    });
  });

  it('плавная коррекция на 2 % и монотонность; скачок > 500 мс — ресинк', () => {
    let offset = 1_000;
    let now = 0;
    const events: ClockEvent[] = [];
    const sync = new ClockSync({ now: () => now, onEvent: (e) => events.push(e) });
    const exchange = () => {
      const p = sync.ping();
      now += 20;
      const s = now + offset;
      now += 20;
      sync.onPong({
        seq: p.seq,
        clientSendMs: p.clientSendMs,
        serverRecvMs: s,
        serverSendMs: s,
        serverTick: 0,
        serverTickStartMs: 0,
        tickIntervalMs: 50,
        serverTickLoadPct: 0,
        serverTickOverrun: false,
      });
    };
    for (let i = 0; i < 16; i++) exchange();
    offset = 940;
    for (let i = 0; i < 16; i++) exchange();
    const reads: number[] = [];
    for (let t = 0; t <= 3_000; t += 100) {
      reads.push(sync.estimatedServerNowMs());
      now += 100;
    }
    for (let i = 1; i < reads.length; i++)
      expect(reads[i]).toBeGreaterThanOrEqual(reads[i - 1] as number);
    expect(Math.abs(sync.clockOffsetMs - 940)).toBeLessThan(2);
    offset = 940 + 850;
    for (let i = 0; i < 16; i++) exchange();
    expect(events.find((e) => e.type === 'clock_resynced')).toMatchObject({
      deltaMs: expect.any(Number),
    });
    expect(sync.estimatedServerTick()).toBeGreaterThan(0);
  });

  it('буфер интерполяции: быстрый рост, плавное снижение ≤ 10 мс/с', () => {
    const l = link(0);
    for (let i = 0; i < 5; i++) l.exchange(20);
    expect(l.sync.interpolationDelayMs).toBe(100);
    for (let i = 0; i < 40; i++) {
      l.exchange(i % 2 === 0 ? 20 : 260);
    }
    const high = l.sync.interpolationDelayMs;
    expect(high).toBeGreaterThan(200);
    expect(high).toBeLessThanOrEqual(300);
    for (let i = 0; i < 40; i++) l.exchange(20);
    l.wait(1_000);
    l.exchange(20);
    const after = l.sync.interpolationDelayMs;
    expect(high - after).toBeGreaterThan(0);
  });

  it('потери, зависание, потеря связи; сон вкладки не считается потерей', () => {
    const l = link(0);
    for (let i = 0; i < 5; i++) l.exchange(20);
    l.sync.ping();
    l.wait(1_500);
    l.sync.check();
    l.wait(1_600);
    l.sync.check();
    expect(l.sync.lossRatio).toBeGreaterThan(0);
    l.wait(1_900);
    l.sync.check();
    expect(l.sync.connectionState).toBe('stalled');
    expect(l.sync.qualityLevel).toBe('critical');
    for (let t = 0; t < 7_000; t += 1_000) {
      l.wait(1_000);
      l.sync.check();
    }
    expect(l.events.some((e) => e.type === 'connection_lost')).toBe(true);

    const s = link(0);
    for (let i = 0; i < 5; i++) s.exchange(20);
    s.sync.ping();
    s.wait(15_000);
    s.sync.check();
    expect(s.sync.lossRatio).toBe(0);
    expect(s.sync.nextDelayMs()).toBe(200);
  });

  it('качество: сразу хуже, лучше — после 3 с; сервер против сети', () => {
    expect(classify(340, 5, 0, false)).toBe('critical');
    expect(classify(20, 5, 0.1, false)).toBe('critical');
    expect(classify(100, 5, 0, false)).toBe('fair');
    const q = new LinkQuality();
    expect(q.update('fair', 0)).toBe('fair');
    expect(q.update('good', 1_000)).toBe('fair');
    expect(q.update('fair', 2_000)).toBe('fair');
    expect(q.update('good', 3_000)).toBe('fair');
    expect(q.update('good', 6_100)).toBe('good');
    const server = link(0, { overrun: true, loadPct: 92 });
    for (let i = 0; i < 5; i++) server.exchange(28);
    expect(server.sync.snapshot()).toMatchObject({
      degradationSource: 'server',
      qualityLevel: 'fair',
    });
    const both = link(0, { overrun: true });
    for (let i = 0; i < 8; i++) both.exchange(240);
    expect(both.sync.snapshot().degradationSource).toBe('both');
    const snapshot = both.events.filter((e) => e.type === 'snapshot').at(-1);
    expect(Object.isFrozen((snapshot as { snapshot: object }).snapshot)).toBe(true);
  });
});
