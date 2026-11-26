import { createHash, randomUUID } from 'node:crypto';
import type { AccessLevel, EntityId } from '@duskmarch/domain';
import {
  PersistError,
  REASON_MAX,
  REASON_MIN,
  STAFF_TX_TYPES,
  type CriticalTxType,
  type LedgerEvent,
} from '@duskmarch/protocol';
import type { Entity, PartitionCore } from '../engine/partition.js';
import type { DirtyTracker } from './dirty-tracker.js';
import type { WorldRowOut } from './flush.js';

export interface TxActor {
  accountId: string;
  accessLevel: AccessLevel;
  characterId?: string;
}

/** Событие журнала, которое формирует план операции. */
export interface PlannedLedger {
  eventKind: LedgerEvent;
  itemId: EntityId;
  sourceItemId?: EntityId;
  amountDelta?: number;
  fromOwnerId?: EntityId | null;
  toOwnerId?: EntityId | null;
  fromParentId?: EntityId | null;
  toParentId?: EntityId | null;
  characterId?: string;
}

export interface TxPlan {
  /** Новое состояние изменённых и созданных сущностей (`data.entityVersion = 0` — новая). */
  upserts: Entity[];
  deletes: EntityId[];
  /** Явная эмиссия и сток по ключу контента (монеты торговцу, компенсация персоналом). */
  minted?: Record<string, number>;
  burned?: Record<string, number>;
  ledger: PlannedLedger[];
  result?: Record<string, unknown>;
}

export interface CriticalTx {
  type: CriticalTxType;
  idempotencyKey?: string;
  actor?: TxActor;
  reason?: string;
  /** Сущности, которые операция читает и меняет (без повторов). */
  participants: EntityId[];
  /** Данные запроса для `payloadHash`. */
  payload: Record<string, unknown>;
  /** Выдача стартового набора: флаг героя ставится в той же транзакции. */
  grantStarterFor?: string;
  /** План по снимку участников; без мутаций ядра. */
  plan(
    get: (id: EntityId) => Entity | undefined,
    newId: (kind: 'item' | 'creature' | 'structure') => EntityId,
  ): TxPlan;
}

export interface TxOutcome {
  txId: string;
  replayed: boolean;
  result: Record<string, unknown>;
}

export interface CommitRequest {
  txId: string;
  txType: CriticalTxType;
  idempotencyKey: string | null;
  payloadHash: string;
  actor: TxActor | null;
  reason: string | null;
  prior: { row: WorldRowOut; expectedVersion: number }[];
  upserts: { row: WorldRowOut; expectedVersion: number }[];
  deletes: { entityId: number; expectedVersion: number }[];
  ledger: (PlannedLedger & {
    realm?: string | null;
    x?: number | null;
    y?: number | null;
    h?: number | null;
  })[];
  result: Record<string, unknown>;
  grantStarterFor?: string;
}

export interface CriticalPorts {
  /** Реестр: запись по ключу идемпотентности. */
  find(
    idempotencyKey: string,
  ): Promise<{ txId: string; payloadHash: string; result: Record<string, unknown> } | null>;
  commit(request: CommitRequest): Promise<void>;
  serialize(entity: Entity): WorldRowOut;
  /** Аудит операций персонала через outbox. */
  audit?(type: CriticalTxType, request: CommitRequest): Promise<void> | void;
}

export interface CriticalOptions {
  lockTimeoutMs?: number;
  txTimeoutMs?: number;
  /** Режим сохранения: в `read_only_degraded` операции отклоняются. */
  mode?: () => 'normal' | 'read_only_degraded';
  onAlert?: (code: string, data: Record<string, unknown>) => void;
}

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );

/** Количество по ключам контента. */
function tally(entities: Iterable<Entity | undefined>): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entities) {
    if (!e?.data || e.kind !== 'item') continue;
    out.set(e.data.contentKey, (out.get(e.data.contentKey) ?? 0) + e.data.amount);
  }
  return out;
}

/** Синхронный координатор: RPO = 0, изменения в памяти — только после коммита. */
export class CriticalTransactionCoordinator {
  private readonly locks = new Map<
    EntityId,
    { txId: string; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly o: Required<Omit<CriticalOptions, 'onAlert'>> & Pick<CriticalOptions, 'onAlert'>;

  constructor(
    private readonly core: PartitionCore,
    private readonly tracker: DirtyTracker<WorldRowOut>,
    private readonly ports: CriticalPorts,
    private readonly newId: (kind: 'item' | 'creature' | 'structure') => EntityId,
    options: CriticalOptions = {},
  ) {
    this.o = { lockTimeoutMs: 5_000, txTimeoutMs: 5_000, mode: () => 'normal', ...options };
  }

  isLocked(id: EntityId): boolean {
    return this.locks.has(id);
  }

  /** Для обработчиков намерений: сущность в транзакции — отказ. */
  guard(id: EntityId): void {
    if (this.locks.has(id))
      throw new PersistError('PERSIST_ENTITY_TX_LOCKED', `сущность ${id} в критической транзакции`);
  }

  private lock(ids: EntityId[], txId: string): void {
    for (const id of ids) {
      if (this.locks.has(id))
        throw new PersistError('PERSIST_ENTITY_TX_LOCKED', `сущность ${id} занята`, {
          entityId: id,
        });
    }
    for (const id of ids) {
      const timer = setTimeout(() => {
        if (this.locks.get(id)?.txId === txId) this.locks.delete(id);
      }, this.o.lockTimeoutMs);
      timer.unref?.();
      this.locks.set(id, { txId, timer });
    }
  }

  private unlock(ids: EntityId[], txId: string): void {
    for (const id of ids) {
      const l = this.locks.get(id);
      if (l?.txId !== txId) continue;
      clearTimeout(l.timer);
      this.locks.delete(id);
    }
  }

  /** Цепочка контейнеров участника (для включения несохранённых изменений). */
  private ancestors(id: EntityId): EntityId[] {
    const out: EntityId[] = [];
    let e = this.core.get(id);
    while (e && e.placement.kind !== 'world' && out.length < 16) {
      const parent: EntityId =
        e.placement.kind === 'container' ? e.placement.parent : e.placement.holder;
      out.push(parent);
      e = this.core.get(parent);
    }
    return out;
  }

  async run(tx: CriticalTx): Promise<TxOutcome> {
    if (this.o.mode() === 'read_only_degraded') {
      throw new PersistError('PERSIST_SERVICE_DEGRADED', 'сохранение мира недоступно');
    }
    if (STAFF_TX_TYPES.has(tx.type)) {
      const reason = tx.reason?.trim() ?? '';
      if (!tx.actor || reason.length < REASON_MIN || reason.length > REASON_MAX) {
        throw new PersistError(
          'PERSIST_AUDIT_REASON_REQUIRED',
          'операция персонала требует исполнителя и обоснования',
        );
      }
    }
    if (new Set(tx.participants).size !== tx.participants.length) {
      throw new PersistError('PERSIST_OWNERSHIP_INVARIANT_VIOLATION', 'участник указан дважды');
    }
    const payloadHash = createHash('sha256')
      .update(canonical({ type: tx.type, participants: tx.participants, payload: tx.payload }))
      .digest('hex');
    if (tx.idempotencyKey) {
      const prev = await this.ports.find(tx.idempotencyKey);
      if (prev) {
        if (prev.payloadHash !== payloadHash)
          throw new PersistError(
            'PERSIST_TX_IDEMPOTENCY_MISMATCH',
            'ключ идемпотентности с другим запросом',
          );
        return { txId: prev.txId, replayed: true, result: prev.result };
      }
    }
    const txId = randomUUID();
    const ids = [...tx.participants].sort((a, b) => a - b);
    this.lock(ids, txId);
    try {
      for (const id of ids) {
        if (!this.core.get(id))
          throw new PersistError(
            'PERSIST_OWNERSHIP_INVARIANT_VIOLATION',
            `участник ${id} не активен`,
            { entityId: id },
          );
      }
      const created: EntityId[] = [];
      const plan = tx.plan(
        (id) => {
          const e = this.core.get(id);
          return e ? structuredClone({ ...e, behaviors: [] }) : undefined;
        },
        (kind) => {
          const id = this.newId(kind);
          created.push(id);
          return id;
        },
      );
      this.checkConservation(tx, plan, created);
      const request = this.request(tx, txId, payloadHash, plan);
      const seq = this.tracker.changeSeq;
      await this.withTimeout(this.ports.commit(request));
      this.apply(plan, request, seq);
      if (STAFF_TX_TYPES.has(tx.type)) await this.ports.audit?.(tx.type, request);
      return { txId, replayed: false, result: request.result };
    } finally {
      this.unlock(ids, txId);
    }
  }

  private checkConservation(tx: CriticalTx, plan: TxPlan, created: EntityId[]): void {
    const touched = new Set<EntityId>([
      ...tx.participants,
      ...plan.upserts.map((e) => e.id),
      ...plan.deletes,
    ]);
    for (const e of plan.upserts) {
      if (!tx.participants.includes(e.id) && !created.includes(e.id)) {
        throw new PersistError(
          'PERSIST_OWNERSHIP_INVARIANT_VIOLATION',
          `сущность ${e.id} не участник операции`,
        );
      }
    }
    const before = tally([...touched].map((id) => this.core.get(id)));
    const afterMap = new Map<EntityId, Entity | undefined>(
      [...touched].map((id) => [id, this.core.get(id)]),
    );
    for (const id of plan.deletes) afterMap.delete(id);
    for (const e of plan.upserts) afterMap.set(e.id, e);
    const after = tally(afterMap.values());
    const keys = new Set([
      ...before.keys(),
      ...after.keys(),
      ...Object.keys(plan.minted ?? {}),
      ...Object.keys(plan.burned ?? {}),
    ]);
    for (const key of keys) {
      const lhs = (before.get(key) ?? 0) + (plan.minted?.[key] ?? 0);
      const rhs = (after.get(key) ?? 0) + (plan.burned?.[key] ?? 0);
      if (lhs !== rhs) {
        this.o.onAlert?.('PERSIST_CONSERVATION_VIOLATION', {
          txType: tx.type,
          contentKey: key,
          before: lhs,
          after: rhs,
        });
        throw new PersistError('PERSIST_CONSERVATION_VIOLATION', `баланс ${key}: ${lhs} ≠ ${rhs}`, {
          contentKey: key,
        });
      }
    }
  }

  private request(tx: CriticalTx, txId: string, payloadHash: string, plan: TxPlan): CommitRequest {
    const priorIds = new Set<EntityId>();
    for (const id of [...tx.participants, ...plan.upserts.map((e) => e.id)]) {
      for (const a of [id, ...this.ancestors(id)]) if (this.tracker.has(a)) priorIds.add(a);
    }
    const prior = this.tracker
      .capture(Infinity, priorIds)
      .filter((c) => c.row)
      .map((c) => ({ row: c.row as WorldRowOut, expectedVersion: c.version }));
    const versionAfterPrior = (id: EntityId) => {
      const p = prior.find((r) => r.row.entityId === id);
      return p ? p.expectedVersion + 1 : this.tracker.versionOf(id);
    };
    const merged = new Map<EntityId, Entity>();
    for (const e of plan.upserts) merged.set(e.id, e);
    const get = (id: EntityId) => merged.get(id) ?? this.core.get(id);
    return {
      txId,
      txType: tx.type,
      idempotencyKey: tx.idempotencyKey ?? null,
      payloadHash,
      actor: tx.actor ?? null,
      reason: tx.reason ?? null,
      prior,
      upserts: plan.upserts.map((e) => ({
        row: { ...this.ports.serialize(e), ...this.rootOf(e, get) },
        expectedVersion:
          (e.data?.entityVersion ?? 0) === 0 && !this.core.get(e.id) ? 0 : versionAfterPrior(e.id),
      })),
      deletes: plan.deletes.map((id) => ({ entityId: id, expectedVersion: versionAfterPrior(id) })),
      ledger: plan.ledger.map((l) => {
        const where = this.core.get(l.itemId)?.placement;
        return where?.kind === 'world' ? { ...l, x: where.x, y: where.y, h: where.h } : l;
      }),
      result: plan.result ?? {},
      ...(tx.grantStarterFor ? { grantStarterFor: tx.grantStarterFor } : {}),
    };
  }

  private rootOf(
    e: Entity,
    get: (id: EntityId) => Entity | undefined,
  ): { rootOwnerId: EntityId | null } {
    let current: Entity | undefined = e;
    for (let i = 0; i < 16 && current && current.placement.kind !== 'world'; i++) {
      const parent: EntityId =
        current.placement.kind === 'container'
          ? current.placement.parent
          : current.placement.holder;
      const next = get(parent);
      if (!next || next.kind === 'hero' || next.placement.kind === 'world')
        return { rootOwnerId: parent };
      current = next;
    }
    return { rootOwnerId: null };
  }

  private async withTimeout(p: Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new PersistError('PERSIST_TX_TIMEOUT', 'транзакция дольше срока')),
            this.o.txTimeoutMs,
          );
        }),
      ]);
    } catch (error) {
      if (error instanceof PersistError) throw error;
      const code = (error as { code?: string }).code;
      if (code === 'PERSIST_TX_CONFLICT' || code === '40001' || code === '40P01')
        throw new PersistError('PERSIST_TX_CONFLICT', String(error));
      throw new PersistError('PERSIST_TX_UNAVAILABLE', String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  /** Коммит подтверждён: перенос в память и снятие отметок изменений. */
  private apply(plan: TxPlan, request: CommitRequest, seq: number): void {
    for (const p of request.prior)
      this.tracker.settle(p.row.entityId as EntityId, p.expectedVersion + 1, seq);
    for (const [i, e] of plan.upserts.entries()) {
      const version = (request.upserts[i]?.expectedVersion ?? 0) + 1;
      const data = e.data ? { ...e.data, entityVersion: version } : undefined;
      const existing = this.core.get(e.id);
      if (existing) {
        if (data) existing.data = data;
        if (JSON.stringify(existing.placement) !== JSON.stringify(e.placement))
          this.core.place(e.id, e.placement);
      } else {
        this.core.spawn({ ...e, behaviors: [], ...(data ? { data } : {}) });
      }
      this.tracker.settle(e.id, version);
    }
    for (const id of plan.deletes) {
      this.core.despawn(id, true);
      this.tracker.settle(id, this.tracker.versionOf(id) + 1);
    }
  }
}
