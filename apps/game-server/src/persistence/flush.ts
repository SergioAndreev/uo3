import type { EntityId } from '@duskmarch/domain';
import type { Entity } from '../engine/partition.js';
import { FIELD, type Captured, type DirtyTracker } from './dirty-tracker.js';

/** Строка мира для записи (совместима с `WriteRow['row']` из `@duskmarch/db/world`). */
export interface WorldRowOut {
  entityId: number;
  kind: string;
  parentId: number | null;
  [column: string]: unknown;
}

export interface FlushBatch {
  upserts: { row: WorldRowOut; expectedVersion: number }[];
  deletes: { entityId: number; expectedVersion: number }[];
}

export interface BatchResult {
  written: number[];
  deleted: number[];
  conflicts: number[];
}

export interface FlushPorts {
  /** Одна транзакция: проверка эпохи, вставка и обновление, мягкое удаление. */
  writeBatch(batch: FlushBatch): Promise<BatchResult>;
  /** Герои пишутся в строку героя P05 (`saveHero`). */
  writeHeroes(ids: readonly EntityId[]): Promise<void>;
}

export interface FlushOptions {
  intervalMs?: number;
  batchSize?: number;
  captureBudgetMs?: number;
  maxUnflushedMs?: number;
  maxQueue?: number;
  retries?: number;
  perfNow?: () => number;
  wallNow?: () => number;
  /** Пауза между повторами (инъекция для детерминированных тестов). */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onMode?: (mode: PersistMode) => void;
  /** Эпоха партиции устарела: запись прекращается сразу. */
  onStale?: () => void;
  log?: (level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) => void;
}

export type PersistMode = 'normal' | 'read_only_degraded';

export interface FlushMetrics {
  lastSuccessfulFlushAt: number | null;
  flushLagMs: number;
  dirtyEntityCount: Record<string, number>;
  captureSliceMaxMs: number;
  flushDurationMs: number;
  rowsUpserted: number;
  rowsSoftDeleted: number;
  versionConflictsTotal: number;
  flushFailuresTotal: number;
  retriesTotal: number;
  cycles: number;
}

const TRANSIENT = new Set(['40P01', '40001']);
const pgCode = (error: unknown): string | undefined => {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
};

/** Топологический порядок: родители раньше вложенных; удаления — вложенные раньше родителей. */
export function orderRows<
  T extends { id: EntityId; kind: string; row: WorldRowOut | null; mask: number },
>(items: readonly T[]): { upserts: T[]; deletes: T[] } {
  const byId = new Map(items.map((i) => [i.id as number, i]));
  const depth = (item: T, seen = new Set<number>()): number => {
    const parent = item.row?.parentId;
    if (parent == null || seen.has(item.id)) return 0;
    const p = byId.get(parent);
    if (!p) return 0;
    seen.add(item.id);
    return 1 + depth(p, seen);
  };
  const key = (a: T, b: T) => depth(a) - depth(b) || a.kind.localeCompare(b.kind) || a.id - b.id;
  return {
    upserts: items.filter((i) => !(i.mask & FIELD.DELETED) && i.row).sort(key),
    deletes: items.filter((i) => i.mask & FIELD.DELETED).sort((a, b) => -key(a, b)),
  };
}

/**
 * Фоновое сохранение партиции: снимок порциями в бюджете тика, запись пакетами,
 * один активный цикл, повторы, деградация при долгом отказе БД.
 */
export class FlushCoordinator {
  readonly o: Required<Omit<FlushOptions, 'onMode' | 'log' | 'onStale'>> &
    Pick<FlushOptions, 'onMode' | 'log' | 'onStale'>;
  stopped = false;
  mode: PersistMode = 'normal';
  private running: Promise<void> | null = null;
  private again = false;
  private capturing: {
    ids: EntityId[];
    cursor: number;
    out: Captured<WorldRowOut>[];
    resolve: () => void;
  } | null = null;
  private failures = 0;
  readonly metrics: FlushMetrics = {
    lastSuccessfulFlushAt: null,
    flushLagMs: 0,
    dirtyEntityCount: {},
    captureSliceMaxMs: 0,
    flushDurationMs: 0,
    rowsUpserted: 0,
    rowsSoftDeleted: 0,
    versionConflictsTotal: 0,
    flushFailuresTotal: 0,
    retriesTotal: 0,
    cycles: 0,
  };

  constructor(
    private readonly tracker: DirtyTracker<WorldRowOut>,
    private readonly ports: FlushPorts,
    options: FlushOptions = {},
  ) {
    this.o = {
      intervalMs: 60_000,
      batchSize: 500,
      captureBudgetMs: 5,
      maxUnflushedMs: 180_000,
      maxQueue: 100_000,
      retries: 3,
      perfNow: () => performance.now(),
      wallNow: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      random: Math.random,
      ...options,
    };
  }

  get busy(): boolean {
    return this.running !== null;
  }

  /** Плановый или ручной цикл; второй параллельный не запускается — следующий планируется сразу после. */
  flush(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.cycle().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        this.o.log?.('warn', 'цикл сохранения дольше периода — следующий запущен сразу');
        void this.flush();
      }
    });
    return this.running;
  }

  /** Вызывается каждый тик (`onPostTick`): порция снимка в бюджете и проверка порога RPO. */
  tick(): void {
    this.checkDegradation();
    const c = this.capturing;
    if (!c) return;
    const started = this.o.perfNow();
    while (c.cursor < c.ids.length) {
      const id = c.ids[c.cursor++] as EntityId;
      c.out.push(...this.tracker.capture(1, [id]));
      if (this.o.perfNow() - started >= this.o.captureBudgetMs) break;
    }
    this.metrics.captureSliceMaxMs = Math.max(
      this.metrics.captureSliceMaxMs,
      this.o.perfNow() - started,
    );
    if (c.cursor >= c.ids.length) {
      this.capturing = null;
      c.resolve();
    }
  }

  /** Снимок всех текущих отметок порциями по тикам. */
  private capture(ids?: readonly EntityId[]): Promise<Captured<WorldRowOut>[]> {
    const list = [...(ids ?? this.dirtyIds())];
    return new Promise((resolve) => {
      const state = {
        ids: list,
        cursor: 0,
        out: [] as Captured<WorldRowOut>[],
        resolve: () => resolve(state.out),
      };
      this.capturing = state;
      if (list.length === 0) {
        this.capturing = null;
        resolve([]);
      }
    });
  }

  private dirtyIds(): EntityId[] {
    return this.tracker.ids();
  }

  private async cycle(): Promise<void> {
    const started = this.o.wallNow();
    this.metrics.cycles++;
    const items = await this.capture();
    await this.writeCaptured(items);
    this.metrics.flushDurationMs = this.o.wallNow() - started;
  }

  /** Срочное целевое сохранение без ожидания плана (выход героя, передача, остановка). */
  async flushNow(ids?: readonly EntityId[]): Promise<void> {
    const items = this.tracker.capture(Infinity, ids ?? undefined);
    await this.writeCaptured(items, false);
  }

  private async writeCaptured(items: Captured<WorldRowOut>[], retryLater = true): Promise<void> {
    if (items.length === 0) {
      this.success();
      return;
    }
    const heroes = items.filter((i) => i.kind === 'hero');
    const world = items.filter((i) => i.kind !== 'hero');
    const { upserts, deletes } = orderRows(world);
    try {
      if (heroes.length > 0) {
        await this.withRetry(() => this.ports.writeHeroes(heroes.map((h) => h.id)));
        for (const h of heroes) this.tracker.ack(h.id, h.changeSeq, h.version);
      }
      for (let i = 0; i < upserts.length; i += this.o.batchSize) {
        await this.writePart(upserts.slice(i, i + this.o.batchSize), []);
      }
      for (let i = 0; i < deletes.length; i += this.o.batchSize) {
        await this.writePart([], deletes.slice(i, i + this.o.batchSize));
      }
      this.success();
    } catch (error) {
      if ((error as { code?: string }).code === 'PERSIST_FENCING_TOKEN_STALE') {
        this.stopped = true;
        this.o.log?.('error', 'эпоха партиции устарела — запись прекращена');
        this.o.onStale?.();
        return;
      }
      this.metrics.flushFailuresTotal++;
      this.failures++;
      this.o.log?.('error', 'сохранение мира не удалось', {
        error: String(error),
        failures: this.failures,
      });
      this.checkDegradation();
      if (!retryLater) throw error;
      const delay =
        Math.min(30_000, 1_000 * 2 ** (this.failures - 1)) * (0.5 + this.o.random() / 2);
      await this.o.sleep(delay);
      this.again = true;
    }
  }

  private async writePart(
    upserts: Captured<WorldRowOut>[],
    deletes: Captured<WorldRowOut>[],
  ): Promise<void> {
    const result = await this.withRetry(() =>
      this.ports.writeBatch({
        upserts: upserts.map((u) => ({ row: u.row as WorldRowOut, expectedVersion: u.version })),
        deletes: deletes.map((d) => ({ entityId: d.id, expectedVersion: d.version })),
      }),
    );
    const ok = new Set([...result.written, ...result.deleted]);
    for (const item of [...upserts, ...deletes]) {
      if (ok.has(item.id)) this.tracker.ack(item.id, item.changeSeq, item.version + 1);
      else if (result.conflicts.includes(item.id)) {
        // Состояние в БД новее (критическая транзакция): устаревшее изменение пропускается.
        this.metrics.versionConflictsTotal++;
        this.tracker.ack(item.id, item.changeSeq, null);
      }
    }
    this.metrics.rowsUpserted += result.written.length;
    this.metrics.rowsSoftDeleted += result.deleted.length;
  }

  private async withRetry<R>(op: () => Promise<R>): Promise<R> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await op();
      } catch (error) {
        if (!TRANSIENT.has(pgCode(error) ?? '') || attempt >= this.o.retries) throw error;
        this.metrics.retriesTotal++;
        await this.o.sleep(Math.round(20 * attempt * (0.5 + this.o.random())));
      }
    }
  }

  private success(): void {
    this.failures = 0;
    this.metrics.lastSuccessfulFlushAt = this.o.wallNow();
    this.refreshMetrics();
    if (this.mode === 'read_only_degraded' && !this.overLimit()) this.setMode('normal');
  }

  private overLimit(): boolean {
    const oldest = this.tracker.oldestMs;
    return (
      (oldest !== null && this.o.wallNow() - oldest > this.o.maxUnflushedMs) ||
      this.tracker.size > this.o.maxQueue
    );
  }

  private checkDegradation(): void {
    this.refreshMetrics();
    if (this.mode === 'normal' && this.overLimit()) this.setMode('read_only_degraded');
  }

  private setMode(mode: PersistMode): void {
    this.mode = mode;
    this.o.log?.(mode === 'normal' ? 'info' : 'error', `режим сохранения: ${mode}`);
    this.o.onMode?.(mode);
  }

  private refreshMetrics(): void {
    const oldest = this.tracker.oldestMs;
    this.metrics.flushLagMs = oldest === null ? 0 : Math.max(0, this.o.wallNow() - oldest);
    this.metrics.dirtyEntityCount = this.tracker.countByKind();
  }
}

/** Корень дерева владения: герой или сущность на земле. */
export function rootOwner(
  get: (id: EntityId) => Entity | undefined,
  entity: Entity,
): EntityId | null {
  let current: Entity | undefined = entity;
  const seen = new Set<EntityId>();
  while (current && current.placement.kind !== 'world' && !seen.has(current.id)) {
    seen.add(current.id);
    const parent: EntityId =
      current.placement.kind === 'container' ? current.placement.parent : current.placement.holder;
    const next = get(parent);
    if (!next) return parent;
    if (next.kind === 'hero' || next.placement.kind === 'world') return next.id;
    current = next;
  }
  return null;
}
