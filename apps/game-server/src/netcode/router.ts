import { hasAccess, type AccessLevel } from '@duskmarch/domain';
import {
  BASE_CATALOG,
  HANDSHAKE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS as SILENCE_TIMEOUT_MS,
  NETCODE_CLOSE,
  NETCODE_OPCODES,
  RATE_LIMITS,
  WALK_WINDOW,
  checkIntent,
  type Catalog,
  type HeroState,
  type IntentSpec,
  type NetcodeErrorCode,
} from '@duskmarch/protocol';
import { cmdError, handshake, type HandshakeConfig } from './handshake.js';
import { RateLimiter, SlidingCounter } from './rate-limit.js';
import { ServerRtt, answerPing, type TickStats } from './time-sync.js';

/** Предел намерений одной сессии в очереди одного тика. */
export const QUEUE_PER_TICK = 32;
const MALFORMED_LIMIT = 20;
const REFUSAL_LIMIT = 50;
const WINDOW_MS = 10_000;

export interface TickInfo {
  readonly tick: number;
  readonly timeMs: number;
}

/** Результат обработчика: ничего или отказ с кодом. */
export type HandlerResult = void | { error: NetcodeErrorCode; details?: Record<string, unknown> };

export type IntentHandler = (session: NetSession, value: never, ctx: TickInfo) => HandlerResult;

export interface NetSessionPorts {
  send: (opcode: number, payload: unknown) => void;
  close: (code: number) => void;
  accessLevel: () => AccessLevel;
  heroState: () => HeroState;
  /** Отказ шага: обработчик движения шлёт авторитарную позицию (P12). */
  walkDeny?: (seq: number) => void;
  /** Аудит-метка сессии: запрещённые команды, нарушения протокола. */
  audit?: (event: string, data: Record<string, unknown>) => void;
}

export type NetSessionState = 'handshake' | 'active' | 'closed';

/** Сетевое состояние одного подключения. */
export class NetSession {
  state: NetSessionState = 'handshake';
  negotiatedVersion: string | null = null;
  readonly limiter: RateLimiter;
  readonly malformed = new SlidingCounter(WINDOW_MS);
  readonly refusals = new SlidingCounter(WINDOW_MS);
  /** Неподтверждённые шаги в окне. */
  pendingSteps = 0;
  queuedTick = -1;
  queuedCount = 0;
  sequence = 0;
  violations = 0;
  readonly rtt = new ServerRtt();
  lastInboundMs: number;
  readonly openedMs: number;

  constructor(
    readonly sessionOrder: number,
    readonly ports: NetSessionPorts,
    nowMs: number,
    limits: typeof RATE_LIMITS = RATE_LIMITS,
  ) {
    this.limiter = new RateLimiter(limits);
    this.lastInboundMs = nowMs;
    this.openedMs = nowMs;
  }

  error(error: NetcodeErrorCode, opts: Parameters<typeof cmdError>[1] = {}): void {
    this.ports.send(NETCODE_OPCODES['cmd.error'], cmdError(error, opts));
  }

  close(code: number, error?: NetcodeErrorCode): void {
    if (this.state === 'closed') return;
    if (error) this.error(error);
    this.state = 'closed';
    this.ports.close(code);
  }

  /** Подтверждение шагов обработчиком движения освобождает окно. */
  ackSteps(count = 1): void {
    this.pendingSteps = Math.max(0, this.pendingSteps - count);
  }
}

export interface IntentRouterOptions {
  room: 'world' | 'hub';
  handshake: HandshakeConfig;
  enqueue: (item: {
    sessionOrder: number;
    sequence: number;
    apply: (ctx: TickInfo) => void;
  }) => void;
  tick: () => number;
  now: () => number;
  catalog?: Catalog;
  log?: (level: 'warn' | 'error', msg: string, data: Record<string, unknown>) => void;
  /** Состояние тика для `time.pong`. */
  tickStats?: () => TickStats;
}

const requestIdOf = (payload: unknown): number | null => {
  const id = (payload as { requestId?: unknown } | null)?.requestId;
  return typeof id === 'number' ? id : null;
};

/**
 * Входящие сообщения сессии: рукопожатие, проверка намерения до очереди тика
 * (размер, опкод, комната, схема, права, состояние, частота, окно шагов, очередь), затем — обработчик в тике.
 */
export class IntentRouter {
  readonly catalog: Catalog;
  private readonly handlers = new Map<string, IntentHandler>();

  constructor(private readonly o: IntentRouterOptions) {
    this.catalog = o.catalog ?? BASE_CATALOG;
  }

  /** Обработчик намерения регистрирует фаза, которая его реализует. */
  handle(name: string, handler: IntentHandler): void {
    if (!this.catalog.byName.has(name)) throw new Error(`намерение ${name} не в каталоге`);
    this.handlers.set(name, handler);
  }

  private violation(
    session: NetSession,
    error: NetcodeErrorCode,
    opcode: number,
    payload: unknown,
    details?: Record<string, unknown>,
  ): void {
    session.violations++;
    session.ports.audit?.('protocol.violation', { error, opcode });
    if (session.malformed.hit(this.o.now()) >= MALFORMED_LIMIT) {
      session.close(NETCODE_CLOSE.PROTOCOL_ERROR, 'PROTO_MALFORMED_FLOOD');
      return;
    }
    session.error(error, {
      requestId: requestIdOf(payload),
      opcode,
      ...(details ? { details } : {}),
    });
  }

  private refuse(
    session: NetSession,
    error: NetcodeErrorCode,
    spec: IntentSpec,
    payload: unknown,
    extra: { retryAfterMs?: number } = {},
  ): void {
    session.error(error, { requestId: requestIdOf(payload), opcode: spec.opcode, ...extra });
  }

  /** Таймауты: нет `session.hello` за 5 с — `4129`; тишина клиента 30 с — `4131`. */
  checkTimeouts(session: NetSession): void {
    const now = this.o.now();
    if (session.state === 'handshake' && now - session.openedMs >= HANDSHAKE_TIMEOUT_MS) {
      session.close(NETCODE_CLOSE.HANDSHAKE_TIMEOUT, 'PROTO_HANDSHAKE_TIMEOUT');
    } else if (session.state === 'active' && now - session.lastInboundMs >= SILENCE_TIMEOUT_MS) {
      session.close(NETCODE_CLOSE.HEARTBEAT_TIMEOUT, 'NET_HEARTBEAT_TIMEOUT');
    }
  }

  /** Входящее сообщение (опкод, тело, размер кадра в байтах). */
  receive(session: NetSession, opcode: number, payload: unknown, frameBytes: number): void {
    if (session.state === 'closed') return;
    session.lastInboundMs = this.o.now();
    if (session.state === 'handshake') {
      if (opcode !== NETCODE_OPCODES['session.hello']) {
        session.error('PROTO_HANDSHAKE_REQUIRED', { requestId: requestIdOf(payload), opcode });
        return;
      }
      const result = handshake(this.o.handshake, payload);
      if (!result.ok) {
        session.ports.send(
          NETCODE_OPCODES['cmd.error'],
          cmdError(result.error, { opcode, details: result.details }),
        );
        session.close(result.close);
        return;
      }
      session.state = 'active';
      session.negotiatedVersion = result.welcome.negotiatedProtocolVersion;
      session.ports.send(NETCODE_OPCODES['session.welcome'], result.welcome);
      return;
    }
    if (opcode === NETCODE_OPCODES['time.ping']) {
      this.ping(session, payload);
      return;
    }
    if (opcode === NETCODE_OPCODES['session.hello']) {
      this.violation(session, 'PROTO_INVALID_PAYLOAD', opcode, payload, {
        reason: 'повторное рукопожатие',
      });
      return;
    }
    const check = checkIntent(this.catalog, opcode, payload, this.o.room, frameBytes);
    if (!check.ok) {
      this.violation(session, check.error, opcode, payload, check.details);
      return;
    }
    const { spec, value } = check;
    if (!hasAccess(session.ports.accessLevel(), spec.minLevel)) {
      session.ports.audit?.('access.denied', {
        intent: spec.name,
        level: session.ports.accessLevel(),
      });
      this.refuse(session, 'CMD_FORBIDDEN_ACCESS_LEVEL', spec, payload);
      return;
    }
    if (!spec.states.includes(session.ports.heroState())) {
      this.refuse(session, 'CMD_INVALID_ENTITY_STATE', spec, payload);
      return;
    }
    const rate = session.limiter.take(spec.rate, this.o.now());
    if (!rate.ok) {
      if (session.refusals.hit(this.o.now()) >= REFUSAL_LIMIT) {
        session.close(NETCODE_CLOSE.RATE_LIMIT_EXCEEDED, 'PROTO_RATE_LIMIT_EXCEEDED');
        return;
      }
      this.refuse(session, 'CMD_RATE_LIMITED', spec, payload, { retryAfterMs: rate.retryAfterMs });
      return;
    }
    const handler = this.handlers.get(spec.name);
    if (!handler) {
      this.refuse(session, 'CMD_HANDLER_UNAVAILABLE', spec, payload);
      return;
    }
    const isStep = spec.name === 'move.walk_req';
    if (isStep && session.pendingSteps >= WALK_WINDOW) {
      this.refuse(session, 'CMD_WALK_WINDOW_EXCEEDED', spec, payload);
      session.ports.walkDeny?.((value as { seq: number }).seq);
      return;
    }
    const tick = this.o.tick();
    if (session.queuedTick !== tick) {
      session.queuedTick = tick;
      session.queuedCount = 0;
    }
    if (session.queuedCount >= QUEUE_PER_TICK) {
      this.refuse(session, 'CMD_QUEUE_OVERFLOW', spec, payload);
      return;
    }
    session.queuedCount++;
    if (isStep) session.pendingSteps++;
    this.o.enqueue({
      sessionOrder: session.sessionOrder,
      sequence: session.sequence++,
      apply: (ctx) => this.run(session, spec, handler, value, payload, ctx),
    });
  }

  /** `time.ping` — сразу, вне очереди тика; частота — категория `time`. */
  private ping(session: NetSession, payload: unknown): void {
    const recv = this.o.now();
    const stats = this.o.tickStats?.() ?? {
      tick: this.o.tick(),
      tickStartMs: recv,
      tickIntervalMs: this.o.handshake.tickIntervalMs,
      loadPct: 0,
      overrun: false,
    };
    const result = answerPing(payload, recv, stats, this.o.now);
    const opcode = NETCODE_OPCODES['time.ping'];
    if (!result.ok) {
      this.violation(session, result.error, opcode, payload);
      return;
    }
    const rate = session.limiter.take('time', recv);
    if (!rate.ok) {
      if (session.refusals.hit(recv) >= REFUSAL_LIMIT) {
        session.close(NETCODE_CLOSE.RATE_LIMIT_EXCEEDED, 'PROTO_RATE_LIMIT_EXCEEDED');
        return;
      }
      session.error('CMD_RATE_LIMITED', { opcode, retryAfterMs: rate.retryAfterMs });
      return;
    }
    session.ports.send(NETCODE_OPCODES['time.pong'], result.pong);
  }

  private run(
    session: NetSession,
    spec: IntentSpec,
    handler: IntentHandler,
    value: unknown,
    payload: unknown,
    ctx: TickInfo,
  ): void {
    if (session.state === 'closed') return;
    try {
      const result = handler(session, value as never, ctx);
      if (result)
        session.error(result.error, {
          requestId: requestIdOf(payload),
          opcode: spec.opcode,
          ...(result.details ? { details: result.details } : {}),
        });
    } catch (error) {
      this.o.log?.('error', 'ошибка обработчика намерения', {
        intent: spec.name,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.refuse(session, 'CMD_INTERNAL_ERROR', spec, payload);
    }
  }
}
