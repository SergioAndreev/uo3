import type { EntityId } from '@duskmarch/domain';
import type { AoiKind, InterestManager } from './interest.js';

export type Priority = 0 | 1 | 2 | 3;

/** Интервал отправки в тиках 20 Гц: [норма, деградация] по приоритету. */
const INTERVALS: Readonly<Record<Priority, readonly [number, number]>> = {
  0: [1, 1],
  1: [1, 2],
  2: [2, 4],
  3: [5, 10],
};

export interface BudgetOptions {
  targetBytesPerSec?: number;
  burstBytesPerSec?: number;
  hardBytesPerSec?: number;
  /** Длительность разрешённого всплеска после рукопожатия или телепорта, мс. */
  burstWindowMs?: number;
  starvationMs?: number;
  tickMs?: number;
}

/** Скользящий учёт байтов за окно. */
class ByteWindow {
  private readonly samples: { at: number; bytes: number }[] = [];
  private total = 0;

  constructor(private readonly windowMs: number) {}

  add(at: number, bytes: number): void {
    this.samples.push({ at, bytes });
    this.total += bytes;
    this.trim(at);
  }

  trim(now: number): void {
    while (this.samples.length && (this.samples[0] as { at: number }).at <= now - this.windowMs) {
      this.total -= (this.samples.shift() as { bytes: number }).bytes;
    }
  }

  perSecond(now: number): number {
    this.trim(now);
    return (this.total * 1000) / this.windowMs;
  }
}

interface ClientBudget {
  second: ByteWindow;
  tenSeconds: ByteWindow;
  burstUntil: number;
  /** 0 — норма; 1 — деградирует P3; 2 — P2 и P3; 3 — P1..P3. */
  level: 0 | 1 | 2 | 3;
  levelChangedAt: number;
}

/** Приоритет сущности для наблюдателя по виду, расстоянию и роли. */
export function priorityOf(
  kind: AoiKind,
  distance: number,
  self: boolean,
  important: boolean,
): Priority {
  if (self) return 0;
  if (kind === 'being') {
    if (distance <= 12 || important) return 1;
    return distance <= 18 ? 2 : 3;
  }
  if (kind === 'item') return distance <= 12 ? 2 : 3;
  return 3;
}

export interface ReplicationMetrics {
  bytesSent: number;
  patches: number;
  deferred: Record<Priority, number>;
  encodeMsP50: number;
  encodeMsP99: number;
}

/**
 * Планировщик репликации: частота по приоритету с учётом нагрузки клиентов,
 * бюджет трафика (окна 1 с и 10 с), всплеск после входа, защита от голодания, метрики.
 */
export class ReplicationScheduler {
  private readonly o: Required<BudgetOptions>;
  private readonly budgets = new Map<EntityId, ClientBudget>();
  private readonly lastSent = new Map<EntityId, number>();
  private readonly dirtySince = new Map<EntityId, number>();
  private readonly encodeMs: number[] = [];
  private readonly metricsState = {
    bytesSent: 0,
    patches: 0,
    deferred: { 0: 0, 1: 0, 2: 0, 3: 0 } as Record<Priority, number>,
  };

  constructor(
    private readonly aoi: InterestManager,
    options: BudgetOptions = {},
  ) {
    this.o = {
      targetBytesPerSec: 16 * 1024,
      burstBytesPerSec: 48 * 1024,
      hardBytesPerSec: 64 * 1024,
      burstWindowMs: 3_000,
      starvationMs: 500,
      tickMs: 50,
      ...options,
    };
  }

  addClient(id: EntityId, nowMs: number): void {
    this.budgets.set(id, {
      second: new ByteWindow(1_000),
      tenSeconds: new ByteWindow(10_000),
      burstUntil: nowMs + this.o.burstWindowMs,
      level: 0,
      levelChangedAt: nowMs,
    });
  }

  removeClient(id: EntityId): void {
    this.budgets.delete(id);
  }

  /** Телепорт или ресинхронизация: снова разрешён всплеск. */
  allowBurst(id: EntityId, nowMs: number): void {
    const b = this.budgets.get(id);
    if (b) b.burstUntil = nowMs + this.o.burstWindowMs;
  }

  levelOf(id: EntityId): number {
    return this.budgets.get(id)?.level ?? 0;
  }

  /** Байты, отправленные клиенту патчем; пересчёт уровня деградации не чаще раза в секунду. */
  record(id: EntityId, bytes: number, nowMs: number): void {
    const b = this.budgets.get(id);
    if (!b) return;
    b.second.add(nowMs, bytes);
    b.tenSeconds.add(nowMs, bytes);
    this.metricsState.bytesSent += bytes;
    this.metricsState.patches++;
    if (nowMs - b.levelChangedAt < 1_000) return;
    const budget = nowMs < b.burstUntil ? this.o.burstBytesPerSec : this.o.targetBytesPerSec;
    const rate = Math.max(
      b.second.perSecond(nowMs),
      nowMs < b.burstUntil ? 0 : b.tenSeconds.perSecond(nowMs),
    );
    if (rate > budget && b.level < 3) {
      b.level++;
      b.levelChangedAt = nowMs;
    } else if (rate < budget * 0.75 && b.level > 0) {
      b.level--;
      b.levelChangedAt = nowMs;
    }
  }

  rateOf(id: EntityId, nowMs: number): number {
    return this.budgets.get(id)?.second.perSecond(nowMs) ?? 0;
  }

  /** Отметка первой мутации сущности (для защиты от голодания). */
  touched(id: EntityId, tick: number): void {
    if (!this.dirtySince.has(id)) this.dirtySince.set(id, tick);
  }

  private interval(
    observer: EntityId,
    entity: EntityId,
  ): { priority: Priority; ticks: number } | null {
    const kind = this.aoi.visibleTo(observer).get(entity);
    const o = this.aoi.observer(observer);
    if (!kind || !o) return null;
    const distance = this.aoi.distanceTo(observer, entity) ?? Infinity;
    const priority = priorityOf(
      kind,
      distance,
      entity === observer,
      o.targets.has(entity) || o.group.has(entity),
    );
    const level = this.budgets.get(observer)?.level ?? 0;
    const degraded = priority > 0 && priority >= 4 - level;
    return { priority, ticks: INTERVALS[priority][degraded ? 1 : 0] };
  }

  /**
   * Нужно ли переносить изменения сущности в этом тике. Объекты схемы общие, поэтому
   * берётся самый частый интервал среди наблюдателей; ожидание дольше `starvationMs` — отправка.
   */
  due(entity: EntityId, tick: number): boolean {
    const since = this.dirtySince.get(entity) ?? tick;
    let best: { priority: Priority; ticks: number } | null = null;
    for (const observer of this.aoi.watchersOf(entity)) {
      const i = this.interval(observer, entity);
      if (i && (!best || i.ticks < best.ticks)) best = i;
    }
    // Приватное состояние владельца — всегда P0.
    if (this.budgets.has(entity)) best = { priority: 0, ticks: 1 };
    const last = this.lastSent.get(entity) ?? -Infinity;
    const starving = (tick - since + 1) * this.o.tickMs >= this.o.starvationMs;
    const ok = !best || tick - last >= best.ticks || starving;
    if (ok) {
      this.lastSent.set(entity, tick);
      this.dirtySince.delete(entity);
    } else if (best) {
      this.metricsState.deferred[best.priority]++;
    }
    return ok;
  }

  forget(entity: EntityId): void {
    this.lastSent.delete(entity);
    this.dirtySince.delete(entity);
  }

  recordEncode(ms: number): void {
    this.encodeMs.push(ms);
    if (this.encodeMs.length > 1_000) this.encodeMs.shift();
  }

  metrics(): ReplicationMetrics {
    const sorted = [...this.encodeMs].sort((a, b) => a - b);
    const q = (p: number) =>
      sorted.length
        ? (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] as number)
        : 0;
    return {
      bytesSent: this.metricsState.bytesSent,
      patches: this.metricsState.patches,
      deferred: { ...this.metricsState.deferred },
      encodeMsP50: q(0.5),
      encodeMsP99: q(0.99),
    };
  }
}
