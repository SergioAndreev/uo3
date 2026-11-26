import { NETCODE_OPCODES, PROTOCOL_VERSION, RUNTIME_OPCODES } from '@duskmarch/protocol';
import { describe, expect, it } from 'vitest';
import {
  NetClient,
  type Connector,
  type NetEvent,
  type RoomLike,
  type Timers,
} from './net-client.js';

const WORLD = 'b'.repeat(64);
const RULES = 'c'.repeat(64);

/** Управляемые часы и таймеры. */
function clockwork() {
  let now = 0;
  let seq = 0;
  const tasks = new Map<number, { at: number; cb: () => void }>();
  const timers: Timers = {
    set: (cb, ms) => {
      tasks.set(++seq, { at: now + ms, cb });
      return seq;
    },
    clear: (h) => void tasks.delete(h as number),
  };
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  const advance = async (ms: number) => {
    const end = now + ms;
    await flush();
    for (;;) {
      const next = [...tasks.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      tasks.delete(next[0]);
      now = next[1].at;
      next[1].cb();
      await flush();
    }
    now = end;
  };
  return { now: () => now, timers, advance };
}

/** Эмулятор комнаты сервера: рукопожатие, pong, токен переподключения. */
class FakeRoom implements RoomLike<{ ok: true }> {
  readonly state = { ok: true as const };
  readonly sent: { type: number; payload: Record<string, unknown> }[] = [];
  private readonly handlers = new Map<number | '*', ((p: never) => void)[]>();
  private readonly leaves: ((code: number) => void)[] = [];
  left = false;

  constructor(private readonly server: { now: () => number; offset: number; reject?: string }) {}

  emit(type: number, payload: unknown): void {
    for (const h of this.handlers.get(type) ?? []) h(payload as never);
    for (const h of this.handlers.get('*') ?? []) h(payload as never);
  }

  send(type: number, payload: Record<string, unknown> = {}): void {
    this.sent.push({ type, payload });
    if (type === NETCODE_OPCODES['session.hello']) {
      queueMicrotask(() => {
        if (this.server.reject) {
          this.emit(NETCODE_OPCODES['cmd.error'], { error: this.server.reject });
          return;
        }
        this.emit(NETCODE_OPCODES['session.welcome'], {
          negotiatedProtocolVersion: payload.protocolVersion,
          minSupportedProtocolVersion: '1.0.0',
          compatibility: 'OK',
          missingPatchIds: [],
          rulesetFingerprint: RULES,
          ruleset: {},
          worldVersion: WORLD,
          serverTick: 10,
          serverTimeMs: 0,
          tickIntervalMs: 50,
        });
        this.emit(RUNTIME_OPCODES['session:reconnect_token'], { sessionId: 's-1', token: 't-1' });
      });
    }
    if (type === NETCODE_OPCODES['time.ping']) {
      const t = this.server.now() + this.server.offset;
      queueMicrotask(() =>
        this.emit(NETCODE_OPCODES['time.pong'], {
          ...payload,
          serverRecvMs: t,
          serverSendMs: t,
          serverTick: 1,
          serverTickStartMs: t,
          tickIntervalMs: 50,
          serverTickLoadPct: 10,
          serverTickOverrun: false,
        }),
      );
    }
  }

  onMessage(type: number | '*', cb: (p: never) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), cb]);
  }

  onLeave(cb: (code: number) => void): void {
    this.leaves.push(cb);
  }

  leave(): void {
    this.left = true;
  }

  drop(code: number): void {
    for (const cb of this.leaves) cb(code);
  }
}

function setup(opts: { reject?: string; failJoins?: number } = {}) {
  const c = clockwork();
  const server = { now: c.now, offset: 420, ...(opts.reject ? { reject: opts.reject } : {}) };
  const joins: { roomId: string; options: Record<string, unknown>; room: FakeRoom }[] = [];
  let fail = opts.failJoins ?? 0;
  const connector: Connector = {
    joinById: async <S>(roomId: string, options: Record<string, unknown>) => {
      if (options.reconnect && fail-- > 0) throw new Error('нет сети');
      const room = new FakeRoom(server);
      joins.push({ roomId, options, room });
      return room as unknown as RoomLike<S>;
    },
  };
  const events: NetEvent[] = [];
  const net = new NetClient({
    connector,
    now: c.now,
    timers: c.timers,
    worldVersion: WORLD,
    onEvent: (e) => events.push(e),
  });
  return { ...c, net, joins, events };
}

const params = {
  accountId: 'acc-1',
  worldRoomId: 'local-dev-proving-0',
  worldTicket: 'w'.repeat(40),
  hubRoomId: 'local-dev-hub',
  hubTicket: 'h'.repeat(40),
};

describe('apps/client: NetClient', () => {
  it('вход: билет, hello с версией и миром, welcome, хаб; калибровка часов', async () => {
    const s = setup();
    const welcome = await s.net.connect(params);
    expect(welcome).toMatchObject({
      negotiatedProtocolVersion: PROTOCOL_VERSION,
      worldVersion: WORLD,
    });
    expect(s.joins.map((j) => j.roomId)).toEqual(['local-dev-proving-0', 'local-dev-hub']);
    expect(s.joins[0]?.options).toEqual({ ticket: params.worldTicket });
    const hello = s.joins[0]?.room.sent.find((m) => m.type === NETCODE_OPCODES['session.hello']);
    expect(hello?.payload).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      worldVersion: WORLD,
    });
    expect(s.net.rulesetFingerprint).toBe(RULES);
    await s.advance(1_000);
    expect(Math.abs(s.net.clock.clockOffsetMs - 420)).toBeLessThanOrEqual(15);
    expect(s.net.snapshot.connectionState).toBe('connected');
    expect(s.net.interpolationDelayMs).toBeGreaterThanOrEqual(100);
  });

  it('отказ рукопожатия — ошибка с кодом', async () => {
    const s = setup({ reject: 'PROTO_WORLD_DATA_INCOMPATIBLE' });
    await expect(s.net.connect(params)).rejects.toMatchObject({
      code: 'PROTO_WORLD_DATA_INCOMPATIBLE',
    });
  });

  it('намерения по каталогу с requestId; ошибки команд — событием', async () => {
    const s = setup();
    await s.net.connect(params);
    const id = s.net.send('world.inspect', { targetId: 7 });
    const sent = s.joins[0]?.room.sent.at(-1);
    expect(sent).toEqual({ type: 0x0125, payload: { targetId: 7, requestId: id } });
    s.net.send('social.hub_chat_send', { channel: 'общий', text: 'привет' });
    expect(s.joins[1]?.room.sent.at(-1)?.type).toBe(0x02f0);
    expect(() => s.net.send('nope.none', {})).toThrow();
    s.joins[0]?.room.emit(NETCODE_OPCODES['cmd.error'], {
      error: 'CMD_TARGET_NOT_FOUND',
      requestId: id,
    });
    expect(s.events).toContainEqual({
      type: 'cmd_error',
      error: { error: 'CMD_TARGET_NOT_FOUND', requestId: id },
    });
  });

  it('обрыв — переподключение по токену в окне; выход игрока — без переподключения', async () => {
    const s = setup({ failJoins: 1 });
    await s.net.connect(params);
    s.joins[0]?.room.drop(1006);
    await s.advance(1_000);
    await s.advance(10);
    const again = s.joins.at(-1);
    expect(again?.options).toEqual({
      reconnect: { accountId: 'acc-1', sessionId: 's-1', token: 't-1' },
    });
    expect(s.events.some((e) => e.type === 'reconnected')).toBe(true);
    expect(s.net.world).toBe(again?.room);
    again?.room.drop(4122);
    expect(s.events.at(-1)).toEqual({ type: 'closed', code: 4122 });
    expect(() => s.net.send('world.inspect', { targetId: 1 })).toThrow();
  });

  it('добровольное отключение закрывает обе комнаты', async () => {
    const s = setup();
    await s.net.connect(params);
    s.net.disconnect();
    expect(s.joins.every((j) => j.room.left)).toBe(true);
    expect(s.net.world).toBeNull();
  });
});
