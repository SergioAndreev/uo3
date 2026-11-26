import { DomainError } from '../errors/index.js';
import {
  KIND_CODES,
  KIND_SHIFT,
  MAX_SEQ,
  makeEntityId,
  seqOf,
  type EntityId,
  type IdOf,
  type WorldEntityKind,
} from './entity-id.js';

const base = (kind: WorldEntityKind): number => (KIND_CODES[kind] << KIND_SHIFT) >>> 0;

export const WORLD_KINDS: readonly WorldEntityKind[] = ['hero', 'creature', 'item', 'structure'];
export const MIN_LEASE = 256;
export const MAX_LEASE = 65_536;
export const DEFAULT_LEASE = 4_096;
const PREFETCH_SHARE = 0.2;

/** Полуинтервал номеров `[from, to)`. */
export interface IdLease {
  kind: WorldEntityKind;
  from: number;
  to: number;
}

export interface IdLeaseProvider {
  lease(kind: WorldEntityKind, size: number): Promise<IdLease>;
}

export function checkLeaseSize(size: number): void {
  if (!Number.isInteger(size) || size < MIN_LEASE || size > MAX_LEASE) {
    throw new DomainError('ERR_INVALID_LEASE_SIZE', `${size} вне ${MIN_LEASE}..${MAX_LEASE}`);
  }
}

/** Поставщик в памяти; P08 заменит его хранилищем в PostgreSQL. */
export class InMemoryIdLeaseProvider implements IdLeaseProvider {
  private readonly next = new Map<WorldEntityKind, number>(WORLD_KINDS.map((k) => [k, 1]));

  constructor(start: Partial<Record<WorldEntityKind, number>> = {}) {
    for (const [kind, seq] of Object.entries(start)) this.next.set(kind as WorldEntityKind, seq);
  }

  lease(kind: WorldEntityKind, size: number): Promise<IdLease> {
    checkLeaseSize(size);
    const from = this.next.get(kind) ?? 1;
    if (from > MAX_SEQ) {
      return Promise.reject(
        new DomainError('ERR_ENTITY_ID_EXHAUSTED', `${kind}: диапазон исчерпан`),
      );
    }
    const to = Math.min(from + size, MAX_SEQ + 1);
    this.next.set(kind, to);
    return Promise.resolve({ kind, from, to });
  }
}

export interface KindSnapshot {
  /** Следующий выдаваемый идентификатор. */
  next: number;
  /** Конец выданного блока: при восстановлении номера ниже не выдаются. */
  highWater: number;
}
export interface AllocatorSnapshot {
  version: 1;
  kinds: Record<WorldEntityKind, KindSnapshot>;
}

export interface FillEvent {
  kind: WorldEntityKind;
  threshold: 80 | 95;
  seq: number;
}

interface Pool {
  next: number;
  end: number;
  pending: Promise<void> | undefined;
  queued: IdLease | undefined;
  warned: Set<80 | 95>;
}

export interface AllocatorOptions {
  leaseSize?: number;
  onFill?: (event: FillEvent) => void;
  /** Ошибки фоновой аренды. */
  onLeaseError?: (error: unknown) => void;
}

/** Монотонная выдача номеров без повторов; аренда следующего блока — заранее и асинхронно. */
export class IdAllocator {
  private readonly size: number;
  private readonly pools = new Map<WorldEntityKind, Pool>();

  constructor(
    private readonly provider: IdLeaseProvider,
    private readonly options: AllocatorOptions = {},
  ) {
    this.size = options.leaseSize ?? DEFAULT_LEASE;
    checkLeaseSize(this.size);
    for (const kind of WORLD_KINDS) {
      this.pools.set(kind, {
        next: 1,
        end: 1,
        pending: undefined,
        queued: undefined,
        warned: new Set(),
      });
    }
  }

  /**
   * Восстанавливает счётчики: `max(загружено + 1, отметка)`; хвост блока не переиспользуется.
   * Поставщик обязан выдавать блоки выше отметки; блок ниже счётчика отбрасывается.
   */
  hydrate(
    state: Partial<Record<WorldEntityKind, { maxLoaded?: number; highWater?: number }>>,
  ): void {
    for (const [name, { maxLoaded, highWater }] of Object.entries(state)) {
      const kind = name as WorldEntityKind;
      const pool = this.pool(kind);
      const loaded = maxLoaded === undefined ? 1 : seqOf(maxLoaded as EntityId) + 1;
      const saved = highWater === undefined ? 1 : highWater - base(kind);
      pool.next = Math.max(loaded, saved, 1);
      pool.end = pool.next;
      pool.queued = undefined;
    }
  }

  /** Получает первые блоки; до готовности `next` отвечает `ERR_ID_LEASE_PENDING`. */
  async ready(): Promise<void> {
    await Promise.all(WORLD_KINDS.map((kind) => this.fetch(kind)));
    for (const kind of WORLD_KINDS) this.swap(this.pool(kind));
  }

  next<K extends WorldEntityKind>(kind: K): IdOf<K> {
    const pool = this.pool(kind);
    if (pool.next >= pool.end) this.swap(pool);
    if (pool.next >= pool.end) {
      if (pool.next > MAX_SEQ) {
        throw new DomainError('ERR_ENTITY_ID_EXHAUSTED', `${kind}: выдан последний номер`);
      }
      void this.fetch(kind);
      throw new DomainError('ERR_ID_LEASE_PENDING', `${kind}: следующий блок ещё не получен`);
    }
    const seq = pool.next++;
    this.warn(kind, pool, seq);
    if (pool.end - pool.next <= this.size * PREFETCH_SHARE && !pool.queued) void this.fetch(kind);
    return makeEntityId(kind, seq);
  }

  /** Числа вида `основание вида + номер`; отметка может равняться основанию следующего вида. */
  snapshot(): AllocatorSnapshot {
    const kinds = Object.fromEntries(
      WORLD_KINDS.map((kind) => {
        const pool = this.pool(kind);
        const end = Math.max(pool.end, pool.queued?.to ?? 0, pool.next);
        return [kind, { next: base(kind) + pool.next, highWater: base(kind) + end }];
      }),
    ) as Record<WorldEntityKind, KindSnapshot>;
    return { version: 1, kinds };
  }

  private pool(kind: WorldEntityKind): Pool {
    const pool = this.pools.get(kind);
    if (!pool) throw new DomainError('ERR_ENTITY_KIND_MISMATCH', `${kind} не вид мира`);
    return pool;
  }

  private swap(pool: Pool): void {
    if (pool.next < pool.end || !pool.queued) return;
    pool.next = Math.max(pool.queued.from, pool.next);
    pool.end = pool.queued.to;
    pool.queued = undefined;
  }

  private fetch(kind: WorldEntityKind): Promise<void> {
    const pool = this.pool(kind);
    if (pool.pending) return pool.pending;
    if (pool.queued) return Promise.resolve();
    pool.pending = this.provider
      .lease(kind, this.size)
      .then((lease) => {
        // Блок ниже восстановленного счётчика обрезается: номера не повторяются.
        if (lease.to > pool.next) pool.queued = { ...lease, from: Math.max(lease.from, pool.next) };
      })
      .catch((error: unknown) => this.options.onLeaseError?.(error))
      .finally(() => {
        pool.pending = undefined;
      });
    return pool.pending;
  }

  private warn(kind: WorldEntityKind, pool: Pool, seq: number): void {
    for (const threshold of [80, 95] as const) {
      if (!pool.warned.has(threshold) && seq >= Math.ceil((MAX_SEQ * threshold) / 100)) {
        pool.warned.add(threshold);
        this.options.onFill?.({ kind, threshold, seq });
      }
    }
  }
}
