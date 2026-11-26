import type { TimePong } from '../netcode/messages.js';

export type QualityLevel = 'good' | 'fair' | 'poor' | 'critical';
export type DegradationSource = 'none' | 'network' | 'server' | 'both';
export type ConnectionState = 'connecting' | 'calibrating' | 'connected' | 'stalled' | 'lost';

export interface LinkSnapshot {
  readonly rttMs: number;
  readonly smoothedRttMs: number;
  readonly jitterMs: number;
  readonly lossRatio: number;
  readonly clockOffsetMs: number;
  readonly interpolationDelayMs: number;
  readonly qualityLevel: QualityLevel;
  readonly degradationSource: DegradationSource;
  readonly connectionState: ConnectionState;
}

export type ClockEvent =
  | { type: 'clock_resynced'; deltaMs: number }
  | { type: 'connection_lost' }
  | { type: 'snapshot'; snapshot: LinkSnapshot };

const THRESHOLDS: readonly [QualityLevel, number, number, number][] = [
  ['good', 80, 20, 0.01],
  ['fair', 160, 50, 0.03],
  ['poor', 300, 100, 0.08],
];
const RANK: Readonly<Record<QualityLevel, number>> = { good: 0, fair: 1, poor: 2, critical: 3 };

/** Уровень по сетевым метрикам без гистерезиса. */
export function classify(
  rtt: number,
  jitter: number,
  loss: number,
  stalled: boolean,
): QualityLevel {
  if (stalled) return 'critical';
  for (const [level, r, j, l] of THRESHOLDS) if (rtt < r && jitter < j && loss < l) return level;
  return 'critical';
}

/** Гистерезис: ухудшение сразу, улучшение — после 3 000 мс устойчиво лучших замеров. */
export class LinkQuality {
  level: QualityLevel = 'good';
  private betterSince: number | null = null;
  private candidate: QualityLevel = 'good';

  update(raw: QualityLevel, now: number): QualityLevel {
    if (RANK[raw] >= RANK[this.level]) {
      this.level = raw;
      this.betterSince = null;
      return this.level;
    }
    if (this.betterSince === null || RANK[raw] > RANK[this.candidate]) {
      this.betterSince = now;
      this.candidate = raw;
    } else if (RANK[raw] < RANK[this.candidate]) {
      this.candidate = raw;
    }
    if (now - this.betterSince >= 3_000) {
      this.level = this.candidate;
      this.betterSince = null;
    }
    return this.level;
  }
}

interface Pending {
  seq: number;
  sentAt: number;
}

export interface ClockSyncOptions {
  /** Монотонные часы клиента, мс. */
  now: () => number;
  onEvent?: (event: ClockEvent) => void;
}

const WINDOW = 16;
const LOSS_WINDOW = 20;

/**
 * Синхронизация часов клиента: зонды, RTT, джиттер, смещение с отсевом выбросов,
 * монотонная оценка серверного времени, буфер интерполяции, качество связи.
 */
export class ClockSync {
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly samples: { rtt: number; offset: number }[] = [];
  private readonly outcomes: boolean[] = [];
  private calibrationLeft = 5;
  private appliedOffset: number | null = null;
  private targetOffset = 0;
  private slewFrom = 0;
  private lastServerNow = -Infinity;
  private lastCall: number;
  private lastFrameAt: number;
  private goodQuietSince: number | null = null;
  private lostAnnounced = false;
  private readonly quality = new LinkQuality();
  private server = { tick: 0, tickStartMs: 0, tickIntervalMs: 50, loadPct: 0, overrun: false };
  rttMs = 0;
  smoothedRttMs = 0;
  jitterMs = 0;
  interpolationDelayMs = 100;
  connectionState: ConnectionState = 'calibrating';
  degradationSource: DegradationSource = 'none';

  constructor(private readonly o: ClockSyncOptions) {
    this.lastCall = o.now();
    this.lastFrameAt = this.lastCall;
    this.slewFrom = this.lastCall;
  }

  private emit(event: ClockEvent): void {
    this.o.onEvent?.(event);
  }

  /** Пауза таймера дольше 2 с: зонды в полёте отбрасываются, калибровка заново. */
  private detectSleep(now: number): void {
    if (now - this.lastCall > 2_000) {
      this.pending.clear();
      this.calibrationLeft = 5;
      this.connectionState = 'calibrating';
      this.lastFrameAt = now;
    }
    this.lastCall = now;
  }

  /** Новый зонд `time.ping`. */
  ping(): { seq: number; clientSendMs: number } {
    const now = this.o.now();
    this.detectSleep(now);
    const seq = ++this.seq;
    this.pending.set(seq, { seq, sentAt: now });
    if (this.calibrationLeft > 0) this.calibrationLeft--;
    return { seq, clientSendMs: now };
  }

  /** Интервал до следующего зонда. */
  nextDelayMs(): number {
    if (this.calibrationLeft > 0) return 200;
    if (this.quality.level === 'poor' || this.quality.level === 'critical') return 1_000;
    const now = this.o.now();
    return this.goodQuietSince !== null && now - this.goodQuietSince >= 30_000 ? 5_000 : 2_000;
  }

  /** Любой кадр сервера продлевает жизнь соединения. */
  onServerFrame(): void {
    this.lastFrameAt = this.o.now();
    this.lostAnnounced = false;
    if (this.connectionState === 'stalled' || this.connectionState === 'lost')
      this.connectionState = 'connected';
  }

  onPong(pong: TimePong): boolean {
    const now = this.o.now();
    this.detectSleep(now);
    const pending = this.pending.get(pong.seq);
    if (!pending || pending.sentAt !== pong.clientSendMs) return false;
    this.pending.delete(pong.seq);
    this.onServerFrame();
    this.record(true);
    const rtt = Math.max(0, now - pong.clientSendMs - (pong.serverSendMs - pong.serverRecvMs));
    const offset = (pong.serverRecvMs - pong.clientSendMs + (pong.serverSendMs - now)) / 2;
    this.samples.push({ rtt, offset });
    if (this.samples.length > WINDOW) this.samples.shift();
    const prev = this.rttMs;
    this.rttMs = rtt;
    this.smoothedRttMs =
      this.samples.length === 1 ? rtt : this.smoothedRttMs + 0.2 * (rtt - this.smoothedRttMs);
    if (this.samples.length > 1) this.jitterMs += 0.125 * (Math.abs(rtt - prev) - this.jitterMs);
    this.server = {
      tick: pong.serverTick,
      tickStartMs: pong.serverTickStartMs,
      tickIntervalMs: pong.tickIntervalMs,
      loadPct: pong.serverTickLoadPct,
      overrun: pong.serverTickOverrun,
    };
    this.updateOffset(now);
    if (this.calibrationLeft === 0 && this.connectionState === 'calibrating')
      this.connectionState = 'connected';
    this.refresh(now);
    return true;
  }

  /** Смещение по замерам без верхних 25 % RTT (медиана оставшихся). */
  private updateOffset(now: number): void {
    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);
    const kept = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.75)));
    const offsets = kept.map((s) => s.offset).sort((a, b) => a - b);
    const median = offsets[Math.floor(offsets.length / 2)] as number;
    if (this.appliedOffset === null) {
      this.appliedOffset = median;
      this.targetOffset = median;
      this.slewFrom = now;
      return;
    }
    const current = this.offsetAt(now);
    if (Math.abs(median - current) > 500) {
      this.appliedOffset = median;
      this.targetOffset = median;
      this.slewFrom = now;
      this.lastServerNow = -Infinity;
      this.emit({ type: 'clock_resynced', deltaMs: median - current });
      return;
    }
    this.appliedOffset = current;
    this.targetOffset = median;
    this.slewFrom = now;
  }

  /** Плавное подтягивание: 2 % хода при расхождении до 150 мс, 5 % — до 500 мс. */
  private offsetAt(now: number): number {
    const from = this.appliedOffset ?? 0;
    const diff = this.targetOffset - from;
    const rate = Math.abs(diff) <= 150 ? 0.02 : 0.05;
    const step = (now - this.slewFrom) * rate;
    return Math.abs(diff) <= step ? this.targetOffset : from + Math.sign(diff) * step;
  }

  get clockOffsetMs(): number {
    return this.offsetAt(this.o.now());
  }

  /** Оценка серверного времени; последовательные чтения не убывают. */
  estimatedServerNowMs(): number {
    const now = this.o.now();
    const value = Math.max(this.lastServerNow, now + this.offsetAt(now));
    this.lastServerNow = value;
    return value;
  }

  estimatedServerTick(): number {
    const { tick, tickStartMs, tickIntervalMs } = this.server;
    return tick + Math.floor((this.estimatedServerNowMs() - tickStartMs) / tickIntervalMs);
  }

  get lossRatio(): number {
    return this.outcomes.length === 0
      ? 0
      : this.outcomes.filter((ok) => !ok).length / this.outcomes.length;
  }

  private record(ok: boolean): void {
    this.outcomes.push(ok);
    if (this.outcomes.length > LOSS_WINDOW) this.outcomes.shift();
  }

  /** Периодическая проверка: потери зондов (3 с), зависание (5 с), потеря связи (12 с), буфер интерполяции. */
  check(): void {
    const now = this.o.now();
    this.detectSleep(now);
    for (const p of [...this.pending.values()]) {
      if (now - p.sentAt >= 3_000) {
        this.pending.delete(p.seq);
        this.record(false);
      }
    }
    const silence = now - this.lastFrameAt;
    if (silence >= 12_000 && !this.lostAnnounced) {
      this.connectionState = 'lost';
      this.lostAnnounced = true;
      this.emit({ type: 'connection_lost' });
    } else if (silence >= 5_000 && this.connectionState !== 'lost')
      this.connectionState = 'stalled';
    this.refresh(now);
  }

  private lastRefresh: number | null = null;

  private refresh(now: number): void {
    const stalled = this.connectionState === 'stalled' || this.connectionState === 'lost';
    const network = classify(this.smoothedRttMs, this.jitterMs, this.lossRatio, stalled);
    const netBad = network !== 'good';
    this.degradationSource = this.server.overrun
      ? netBad
        ? 'both'
        : 'server'
      : netBad
        ? 'network'
        : 'none';
    const shown = this.server.overrun && network === 'good' ? 'fair' : network;
    this.quality.update(shown, now);
    this.goodQuietSince =
      this.quality.level === 'good' && this.jitterMs < 10 ? (this.goodQuietSince ?? now) : null;
    const target = Math.min(300, Math.max(100, 2 * this.server.tickIntervalMs + 2 * this.jitterMs));
    const elapsed = this.lastRefresh === null ? 0 : (now - this.lastRefresh) / 1000;
    this.interpolationDelayMs =
      target >= this.interpolationDelayMs
        ? target
        : Math.max(target, this.interpolationDelayMs - 10 * elapsed);
    this.lastRefresh = now;
    this.emit({ type: 'snapshot', snapshot: this.snapshot() });
  }

  get qualityLevel(): QualityLevel {
    return this.quality.level;
  }

  /** Неизменяемый согласованный снимок. */
  snapshot(): LinkSnapshot {
    return Object.freeze({
      rttMs: this.rttMs,
      smoothedRttMs: this.smoothedRttMs,
      jitterMs: this.jitterMs,
      lossRatio: this.lossRatio,
      clockOffsetMs: this.clockOffsetMs,
      interpolationDelayMs: this.interpolationDelayMs,
      qualityLevel: this.quality.level,
      degradationSource: this.degradationSource,
      connectionState: this.connectionState,
    });
  }
}
