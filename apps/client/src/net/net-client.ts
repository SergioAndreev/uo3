import {
  BASE_CATALOG,
  ClockSync,
  NETCODE_OPCODES,
  PROTOCOL_VERSION,
  RUNTIME_OPCODES,
  type ClockEvent,
  type LinkSnapshot,
  type SessionWelcome,
  type TimePong,
} from '@duskmarch/protocol';

/** Минимальный интерфейс комнаты (совместим с `colyseus.js` Room). */
export interface RoomLike<S = unknown> {
  readonly state: S;
  send(type: number, payload?: unknown): void;
  onMessage(type: number | '*', callback: (payload: never) => void): unknown;
  onLeave(callback: (code: number) => void): unknown;
  leave(consented?: boolean): unknown;
}

export interface Connector {
  joinById<S>(roomId: string, options: Record<string, unknown>): Promise<RoomLike<S>>;
}

export interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export type NetEvent =
  | ClockEvent
  | { type: 'welcome'; welcome: SessionWelcome }
  | { type: 'cmd_error'; error: Record<string, unknown> }
  | { type: 'reconnecting'; code: number; attempt: number }
  | { type: 'reconnected' }
  | { type: 'closed'; code: number };

export interface NetClientOptions {
  connector: Connector;
  /** Монотонные часы клиента, мс. */
  now: () => number;
  timers?: Timers;
  rulesetFingerprint?: string;
  worldVersion: string;
  patchIds?: string[];
  protocolVersion?: string;
  onEvent?: (event: NetEvent) => void;
  /** Окно переподключения P06, мс. */
  reconnectWindowMs?: number;
  handshakeTimeoutMs?: number;
}

export interface ConnectParams {
  accountId: string;
  worldRoomId: string;
  worldTicket: string;
  hubRoomId?: string;
  hubTicket?: string;
}

/** Закрытия, после которых клиент пробует переподключиться по токену P06. */
export const RECONNECTABLE = new Set([1001, 1005, 1006, 4113, 4119, 4129, 4130, 4131]);

const defaultTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class NetError extends Error {
  constructor(
    readonly code: number | string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Сетевой клиент: комнаты партиции и хаба, рукопожатие, зонды времени, качество связи,
 * буфер интерполяции, переподключение по токену. Без React — UI подключается в P09.
 */
export class NetClient<S = unknown> {
  readonly clock: ClockSync;
  world: RoomLike<S> | null = null;
  hub: RoomLike | null = null;
  welcome: SessionWelcome | null = null;
  rulesetFingerprint: string;
  private reconnect: { sessionId: string; token: string } | null = null;
  private params: ConnectParams | null = null;
  private pingTimer: unknown = null;
  private checkTimer: unknown = null;
  private requestId = 0;
  private closedByUser = false;
  private readonly timers: Timers;

  constructor(private readonly o: NetClientOptions) {
    this.timers = o.timers ?? defaultTimers;
    this.rulesetFingerprint = o.rulesetFingerprint ?? '0'.repeat(64);
    this.clock = new ClockSync({ now: o.now, onEvent: (e) => this.emit(e) });
  }

  private emit(event: NetEvent): void {
    this.o.onEvent?.(event);
  }

  get snapshot(): LinkSnapshot {
    return this.clock.snapshot();
  }

  get interpolationDelayMs(): number {
    return this.clock.interpolationDelayMs;
  }

  /** Вход: комната партиции по билету, рукопожатие, затем хаб. */
  async connect(params: ConnectParams): Promise<SessionWelcome> {
    this.params = params;
    this.closedByUser = false;
    const room = await this.o.connector.joinById<S>(params.worldRoomId, {
      ticket: params.worldTicket,
    });
    const welcome = await this.attach(room);
    if (params.hubRoomId && params.hubTicket) {
      this.hub = await this.o.connector.joinById(params.hubRoomId, { ticket: params.hubTicket });
      this.hub.onMessage('*', () => undefined);
      await this.handshake(this.hub);
    }
    return welcome;
  }

  /** Привязка комнаты партиции: обработчики, рукопожатие, зонды. */
  private async attach(room: RoomLike<S>): Promise<SessionWelcome> {
    this.world = room;
    room.onMessage(RUNTIME_OPCODES['session:reconnect_token'], ((p: {
      sessionId: string;
      token: string;
    }) => {
      this.reconnect = { sessionId: p.sessionId, token: p.token };
    }) as never);
    room.onMessage(NETCODE_OPCODES['time.pong'], ((pong: TimePong) => {
      this.clock.onPong(pong);
    }) as never);
    room.onMessage(NETCODE_OPCODES['cmd.error'], ((error: Record<string, unknown>) => {
      this.emit({ type: 'cmd_error', error });
    }) as never);
    room.onMessage('*', (() => this.clock.onServerFrame()) as never);
    room.onLeave((code) => this.onWorldLeave(room, code));
    const welcome = await this.handshake(room);
    this.welcome = welcome;
    this.rulesetFingerprint = welcome.rulesetFingerprint;
    this.emit({ type: 'welcome', welcome });
    this.startProbes();
    return welcome;
  }

  /** `session.hello` → `session.welcome`; ошибка или закрытие — отказ. */
  private handshake<T>(room: RoomLike<T>): Promise<SessionWelcome> {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = this.timers.set(
        () => finish(new NetError('PROTO_HANDSHAKE_TIMEOUT', 'нет session.welcome')),
        this.o.handshakeTimeoutMs ?? 5_000,
      );
      const finish = (result: SessionWelcome | Error) => {
        if (done) return;
        done = true;
        this.timers.clear(timer);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      room.onMessage(NETCODE_OPCODES['session.welcome'], ((w: SessionWelcome) =>
        finish(w)) as never);
      room.onMessage(NETCODE_OPCODES['cmd.error'], ((e: { error: string }) => {
        if (!done) finish(new NetError(e.error, 'отказ рукопожатия'));
      }) as never);
      room.onLeave((code) => finish(new NetError(code, `закрыто ${code}`)));
      room.send(NETCODE_OPCODES['session.hello'], {
        protocolVersion: this.o.protocolVersion ?? PROTOCOL_VERSION,
        rulesetFingerprint: this.rulesetFingerprint,
        worldVersion: this.o.worldVersion,
        ...(this.o.patchIds ? { patchIds: this.o.patchIds } : {}),
      });
    });
  }

  private startProbes(): void {
    this.stopProbes();
    const ping = () => {
      if (!this.world) return;
      this.world.send(NETCODE_OPCODES['time.ping'], this.clock.ping());
      this.pingTimer = this.timers.set(ping, this.clock.nextDelayMs());
    };
    const check = () => {
      this.clock.check();
      this.checkTimer = this.timers.set(check, 250);
    };
    ping();
    this.checkTimer = this.timers.set(check, 250);
  }

  private stopProbes(): void {
    if (this.pingTimer) this.timers.clear(this.pingTimer);
    if (this.checkTimer) this.timers.clear(this.checkTimer);
    this.pingTimer = this.checkTimer = null;
  }

  private async onWorldLeave(room: RoomLike<S>, code: number): Promise<void> {
    if (room !== this.world) return;
    this.stopProbes();
    this.world = null;
    if (this.closedByUser || !RECONNECTABLE.has(code) || !this.reconnect || !this.params) {
      this.emit({ type: 'closed', code });
      return;
    }
    const deadline = this.o.now() + (this.o.reconnectWindowMs ?? 30_000);
    for (let attempt = 1; this.o.now() < deadline && !this.closedByUser; attempt++) {
      this.emit({ type: 'reconnecting', code, attempt });
      try {
        const next = await this.o.connector.joinById<S>(this.params.worldRoomId, {
          reconnect: { accountId: this.params.accountId, ...this.reconnect },
        });
        await this.attach(next);
        this.emit({ type: 'reconnected' });
        return;
      } catch {
        await new Promise<void>((resolve) =>
          this.timers.set(resolve, Math.min(5_000, 250 * 2 ** attempt)),
        );
      }
    }
    this.emit({ type: 'closed', code });
  }

  /** Намерение по имени каталога; `requestId` для корреляции с `cmd.error`. */
  send(intent: string, payload: Record<string, unknown>): number {
    const spec = BASE_CATALOG.byName.get(intent);
    if (!spec) throw new NetError('PROTO_UNKNOWN_OPCODE', `нет намерения ${intent}`);
    const room = spec.room === 'hub' ? this.hub : this.world;
    if (!room) throw new NetError('NOT_CONNECTED', 'нет соединения');
    const requestId = ++this.requestId;
    room.send(spec.opcode, { ...payload, requestId });
    return requestId;
  }

  /** Добровольное отключение (без переподключения). */
  disconnect(): void {
    this.closedByUser = true;
    this.stopProbes();
    this.world?.leave(true);
    this.hub?.leave(true);
    this.world = this.hub = null;
  }
}
