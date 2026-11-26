import { TimePing, type TimePong } from '@duskmarch/protocol';
import { Value } from '@sinclair/typebox/value';

export interface TickStats {
  tick: number;
  /** Монотонное время начала тика на сервере, мс. */
  tickStartMs: number;
  tickIntervalMs: number;
  /** Нагрузка тика: p99 длительности к интервалу, %. */
  loadPct: number;
  overrun: boolean;
}

export type PongResult =
  { ok: true; pong: TimePong } | { ok: false; error: 'PROTO_INVALID_PAYLOAD' };

/** Ответ на `time.ping` сразу при приёме, вне очереди тика. */
export function answerPing(
  payload: unknown,
  recvMs: number,
  stats: TickStats,
  now: () => number,
): PongResult {
  if (!Value.Check(TimePing, payload) || !Number.isFinite(payload.clientSendMs)) {
    return { ok: false, error: 'PROTO_INVALID_PAYLOAD' };
  }
  return {
    ok: true,
    pong: {
      seq: payload.seq,
      clientSendMs: payload.clientSendMs,
      serverRecvMs: recvMs,
      serverSendMs: now(),
      serverTick: stats.tick,
      serverTickStartMs: stats.tickStartMs,
      tickIntervalMs: stats.tickIntervalMs,
      serverTickLoadPct: Math.min(255, Math.max(0, Math.round(stats.loadPct))),
      serverTickOverrun: stats.overrun,
    },
  };
}

export const SESSION_RTT_CAP_MS = 500;

/**
 * Серверная оценка RTT сессии по собственным монотонным меткам: время между отправкой
 * протокольного ping WebSocket и ответным pong. Числам клиента не доверяет; потолок 500 мс.
 */
export class ServerRtt {
  private sentAt: number | null = null;
  private samples = 0;
  sessionRttMs = 0;
  sessionJitterMs = 0;

  /** Отправлен зонд; повторный до ответа не перезаписывает время первого. */
  probeSent(nowMs: number): void {
    this.sentAt ??= nowMs;
  }

  /** Ответ на зонд; без отправленного зонда игнорируется. */
  probeReplied(nowMs: number): number | null {
    if (this.sentAt === null) return null;
    const rtt = Math.min(SESSION_RTT_CAP_MS, Math.max(0, nowMs - this.sentAt));
    this.sentAt = null;
    if (this.samples++ === 0) {
      this.sessionRttMs = rtt;
    } else {
      this.sessionJitterMs += (Math.abs(rtt - this.sessionRttMs) - this.sessionJitterMs) / 8;
      this.sessionRttMs += (rtt - this.sessionRttMs) / 8;
    }
    return rtt;
  }
}
