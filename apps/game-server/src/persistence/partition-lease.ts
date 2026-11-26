export interface LeaseRepo {
  acquire(nodeId: string, ttlMs: number, now?: Date): Promise<{ epoch: number; expiresAt: Date }>;
  renew(epoch: number, ttlMs: number, now?: Date): Promise<boolean>;
  release(epoch: number): Promise<void>;
}

export interface LeaseTimers {
  every(ms: number, callback: () => void): unknown;
  cancel(handle: unknown): void;
}

export interface PartitionLeaseOptions {
  repo: LeaseRepo;
  nodeId: string;
  ttlMs?: number;
  renewMs?: number;
  timers?: LeaseTimers;
  now?: () => Date;
  /** Эпоха утрачена: узел останавливает партицию (`4117`). */
  onLost: (reason: 'stale' | 'expired') => void;
  log?: (level: 'warn' | 'error', msg: string, data?: Record<string, unknown>) => void;
}

const realTimers: LeaseTimers = {
  every: (ms, callback) => setInterval(callback, ms),
  cancel: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/**
 * Аренда партиции на узле: захват при старте, продление каждые 5 с (TTL 15 с).
 * Отказ продления — эпоха устарела; продление невозможно дольше TTL — аренда считается истёкшей.
 */
export class PartitionLease {
  epoch = 0;
  lost = false;
  private handle: unknown = null;
  private lastRenewed = 0;
  private readonly ttlMs: number;
  private readonly now: () => Date;

  constructor(private readonly o: PartitionLeaseOptions) {
    this.ttlMs = o.ttlMs ?? 15_000;
    this.now = o.now ?? (() => new Date());
  }

  async acquire(): Promise<number> {
    const lease = await this.o.repo.acquire(this.o.nodeId, this.ttlMs, this.now());
    this.epoch = lease.epoch;
    this.lastRenewed = this.now().getTime();
    const timers = this.o.timers ?? realTimers;
    this.handle = timers.every(this.o.renewMs ?? 5_000, () => void this.renew());
    return this.epoch;
  }

  /** Одно продление; вызывается таймером. */
  async renew(): Promise<void> {
    if (this.lost) return;
    const at = this.now();
    try {
      if (await this.o.repo.renew(this.epoch, this.ttlMs, at)) {
        this.lastRenewed = at.getTime();
        return;
      }
      this.lose('stale');
    } catch (error) {
      this.o.log?.('warn', 'продление аренды партиции не удалось', { error: String(error) });
      if (at.getTime() - this.lastRenewed >= this.ttlMs) this.lose('expired');
    }
  }

  private lose(reason: 'stale' | 'expired'): void {
    if (this.lost) return;
    this.lost = true;
    this.stopTimer();
    this.o.onLost(reason);
  }

  private stopTimer(): void {
    if (this.handle !== null) (this.o.timers ?? realTimers).cancel(this.handle);
    this.handle = null;
  }

  /** Плановая остановка: аренда освобождается для следующего узла. */
  async release(): Promise<void> {
    this.stopTimer();
    if (!this.lost && this.epoch > 0) await this.o.repo.release(this.epoch);
  }
}
