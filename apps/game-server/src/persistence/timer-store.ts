import { randomUUID } from 'node:crypto';
import type { Database } from '@duskmarch/db';
import { deleteTimer, insertTimer, listTimers, saveTimerRemaining } from '@duskmarch/db/world';
import type { EntityId } from '@duskmarch/domain';
import type { Scheduler } from '../engine/scheduler.js';
import type { TimerHandle } from '../engine/timing-wheel.js';
import { planTimers, type StoredTimer, type TimerPolicy } from './world-clock.js';

export type TimerHandler = (
  timer: StoredTimer & { entityId: EntityId | null; payload: Record<string, unknown> },
) => void;

interface Live {
  timer: StoredTimer & { entityId: EntityId | null; payload: Record<string, unknown> };
  handle: TimerHandle;
}

/** Длительные таймеры мира: в БД и в колесе планировщика; обработчики регистрируют фазы-владельцы. */
export class TimerStore {
  private readonly handlers = new Map<string, TimerHandler>();
  private readonly live = new Map<string, Live>();

  constructor(
    private readonly db: Database,
    private readonly shardId: string,
    private readonly scheduler: Scheduler,
    private readonly now: () => Date = () => new Date(),
    private readonly log?: (level: 'warn', msg: string, data: Record<string, unknown>) => void,
  ) {}

  on(kind: string, handler: TimerHandler): void {
    this.handlers.set(kind, handler);
  }

  get size(): number {
    return this.live.size;
  }

  private arm(timer: Live['timer'], delayMs: number): void {
    const handle = this.scheduler.after(delayMs, () => {
      this.live.delete(timer.id);
      void deleteTimer(this.db, timer.id);
      const handler = this.handlers.get(timer.kind);
      if (handler) handler(timer);
      else this.log?.('warn', 'таймер без обработчика', { kind: timer.kind, id: timer.id });
    });
    this.live.set(timer.id, { timer, handle });
  }

  /** Загрузка при старте по плану восстановления. */
  async restore(): Promise<number> {
    const rows = await listTimers(this.db, this.shardId);
    const plan = planTimers(
      rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        policy: r.policy as TimerPolicy,
        remainingMs: r.remainingMs,
        dueAt: r.dueAt,
      })),
      this.now(),
      this.scheduler.tickMs,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const { timer, delayMs } of plan) {
      const r = byId.get(timer.id);
      this.arm(
        {
          ...timer,
          entityId: (r?.entityId ?? null) as EntityId | null,
          payload: (r?.payload ?? {}) as Record<string, unknown>,
        },
        delayMs,
      );
    }
    return plan.length;
  }

  async create(
    kind: string,
    delayMs: number,
    policy: TimerPolicy,
    entityId: EntityId | null = null,
    payload: Record<string, unknown> = {},
  ): Promise<string> {
    const id = randomUUID();
    const now = this.now();
    const dueAt = new Date(now.getTime() + delayMs);
    await insertTimer(this.db, {
      id,
      shardId: this.shardId,
      entityId,
      kind,
      policy,
      remainingMs: delayMs,
      dueAt,
      payload,
      createdAt: now,
    });
    this.arm({ id, kind, policy, remainingMs: delayMs, dueAt, entityId, payload }, delayMs);
    return id;
  }

  async cancel(id: string): Promise<void> {
    const live = this.live.get(id);
    if (live) this.scheduler.cancel(live.handle);
    this.live.delete(id);
    await deleteTimer(this.db, id);
  }

  /** Остановка: остатки по игровому времени планировщика. */
  async persist(): Promise<void> {
    const now = this.now();
    await saveTimerRemaining(
      this.db,
      [...this.live.values()].map(({ timer, handle }) => {
        const remainingMs = this.scheduler.remainingMs(handle) ?? 0;
        return { id: timer.id, remainingMs, dueAt: new Date(now.getTime() + remainingMs) };
      }),
    );
  }
}
