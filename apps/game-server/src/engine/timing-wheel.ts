import { EngineError } from './errors.js';

export type TimerPriority = 'critical' | 'normal' | 'background';
const RANK: Readonly<Record<TimerPriority, number>> = { critical: 0, normal: 1, background: 2 };

/** Непрозрачный дескриптор таймера; поколение защищает от отмены чужого таймера. */
export interface TimerHandle {
  readonly id: number;
  readonly generation: number;
}

interface Entry {
  id: number;
  generation: number;
  due: number;
  seq: number;
  rank: number;
  interval: number;
  callback: () => void;
  live: boolean;
}

/** Размеры уровней по умолчанию: 256 тиков, затем 64 × 256, 64 × 16 384, 64 × 1 048 576 (≈ 38,8 суток при 50 мс). */
export const DEFAULT_LEVEL_SIZES: readonly number[] = [256, 64, 64, 64];
export const WHEEL_RANGE_TICKS = 256 * 64 * 64 * 64;

/**
 * Иерархическое колесо таймеров с разрешением в один тик.
 * Постановка, отмена и шаг — амортизированно O(1); сроки дальше диапазона ждут в очереди переполнения.
 */
export class TimingWheel {
  private readonly sizes: readonly number[];
  private readonly spans: number[];
  private readonly range: number;
  private readonly levels: Entry[][][];
  private overflow: Entry[] = [];
  private readonly entries = new Map<number, Entry>();
  private nextId = 1;
  private seq = 0;
  private tick: number;

  /** `sizes` — размеры уровней; меньшие значения нужны только тестам очереди переполнения. */
  constructor(startTick = 0, sizes: readonly number[] = DEFAULT_LEVEL_SIZES) {
    this.tick = startTick;
    this.sizes = sizes;
    this.spans = sizes.map((_, i) => sizes.slice(0, i).reduce((a, b) => a * b, 1));
    this.range = sizes.reduce((a, b) => a * b, 1);
    this.levels = sizes.map((size) => Array.from({ length: size }, () => []));
  }

  /** Покрытие колеса в тиках; дальше — очередь переполнения. */
  get rangeTicks(): number {
    return this.range;
  }

  /** Текущий (последний обработанный) тик. */
  get currentTick(): number {
    return this.tick;
  }

  get size(): number {
    return this.entries.size;
  }

  private place(entry: Entry): void {
    const delta = entry.due - this.tick;
    for (let level = 0; level < this.sizes.length; level++) {
      const span = this.spans[level] as number;
      const size = this.sizes[level] as number;
      if (delta < span * size) {
        (this.levels[level] as Entry[][])[Math.floor(entry.due / span) % size]?.push(entry);
        return;
      }
    }
    this.overflow.push(entry);
  }

  /** Таймер на тик `due` (> текущего); 0 и прошлые сроки — следующий тик. */
  scheduleAt(
    due: number,
    callback: () => void,
    priority: TimerPriority = 'normal',
    interval = 0,
  ): TimerHandle {
    if (!Number.isFinite(due) || !Number.isFinite(interval) || interval < 0) {
      throw new EngineError('SCHEDULER_INVALID_DELAY', `срок ${due}, интервал ${interval}`);
    }
    const entry: Entry = {
      id: this.nextId++,
      generation: 1,
      due: Math.max(this.tick + 1, Math.floor(due)),
      seq: this.seq++,
      rank: RANK[priority],
      interval: Math.floor(interval),
      callback,
      live: true,
    };
    this.entries.set(entry.id, entry);
    this.place(entry);
    return { id: entry.id, generation: entry.generation };
  }

  /** Через `delayTicks` тиков (минимум следующий тик). */
  schedule(
    delayTicks: number,
    callback: () => void,
    priority: TimerPriority = 'normal',
  ): TimerHandle {
    if (!Number.isFinite(delayTicks) || delayTicks < 0) {
      throw new EngineError('SCHEDULER_INVALID_DELAY', `задержка ${delayTicks} тиков`);
    }
    return this.scheduleAt(this.tick + Math.max(1, Math.ceil(delayTicks)), callback, priority);
  }

  /** Периодический таймер с фиксированным шагом без накопления дрейфа. */
  every(
    intervalTicks: number,
    callback: () => void,
    priority: TimerPriority = 'normal',
  ): TimerHandle {
    if (!Number.isFinite(intervalTicks) || intervalTicks < 1) {
      throw new EngineError('SCHEDULER_INVALID_DELAY', `интервал ${intervalTicks} тиков`);
    }
    const ticks = Math.ceil(intervalTicks);
    return this.scheduleAt(this.tick + ticks, callback, priority, ticks);
  }

  cancel(handle: TimerHandle): boolean {
    const entry = this.entries.get(handle.id);
    if (!entry || entry.generation !== handle.generation || !entry.live) return false;
    entry.live = false;
    this.entries.delete(entry.id);
    return true;
  }

  /** Тиков до срабатывания; `null` — таймер неактивен. */
  remaining(handle: TimerHandle): number | null {
    const entry = this.entries.get(handle.id);
    return entry && entry.generation === handle.generation ? entry.due - this.tick : null;
  }

  private cascade(level: number): void {
    const span = this.spans[level] as number;
    const size = this.sizes[level] as number;
    const slots = this.levels[level] as Entry[][];
    const index = Math.floor(this.tick / span) % size;
    const moved = slots[index] as Entry[];
    slots[index] = [];
    for (const entry of moved) if (entry.live) this.place(entry);
  }

  /**
   * Переходит на следующий тик и возвращает созревшие таймеры в порядке приоритета и постановки.
   * Вызов `run` выполняет их; разделение нужно планировщику для бюджета фоновых задач.
   */
  advance(): { tick: number; due: (() => void)[]; background: (() => void)[] } {
    this.tick++;
    if (this.tick % this.range === 0 && this.overflow.length > 0) {
      const pending = this.overflow;
      this.overflow = [];
      for (const entry of pending) if (entry.live) this.place(entry);
    }
    for (let level = this.sizes.length - 1; level >= 1; level--) {
      if (this.tick % (this.spans[level] as number) === 0) this.cascade(level);
    }
    const slot = this.tick % (this.sizes[0] as number);
    const bucket = (this.levels[0] as Entry[][])[slot] as Entry[];
    (this.levels[0] as Entry[][])[slot] = [];
    const ready = bucket.filter((e) => e.live && e.due === this.tick);
    for (const e of bucket) if (e.live && e.due !== this.tick) this.place(e);
    ready.sort((a, b) => a.rank - b.rank || a.seq - b.seq);
    const due: (() => void)[] = [];
    const background: (() => void)[] = [];
    for (const entry of ready) {
      const fire = () => {
        if (!entry.live) return;
        if (entry.interval > 0) {
          entry.due += entry.interval;
          entry.seq = this.seq++;
          this.place(entry);
        } else {
          entry.live = false;
          this.entries.delete(entry.id);
        }
        entry.callback();
      };
      (entry.rank === RANK.background ? background : due).push(fire);
    }
    return { tick: this.tick, due, background };
  }
}
