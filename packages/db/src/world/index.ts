import { WorldStoreError, type Executor, type WorldRow } from './common.js';
export * from './common.js';
export * from './invariants.js';
import {
  KIND_CODES,
  KIND_SHIFT,
  MAX_SEQ,
  checkLeaseSize,
  type IdLease,
  type IdLeaseProvider,
  type WorldEntityKind,
} from '@duskmarch/domain';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import {
  partitionLeases,
  shardEntitySequences,
  shardWorldState,
  worldEntities,
  worldTimers,
  backupCatalog,
  characters,
  criticalTransactions,
  restorePoints,
  itemLedger,
} from '../schema/index.js';

const COLUMN = {
  creature: shardEntitySequences.nextCreature,
  item: shardEntitySequences.nextItem,
  structure: shardEntitySequences.nextStructure,
} as const;
const COLUMN_NAME = {
  creature: 'next_creature',
  item: 'next_item',
  structure: 'next_structure',
} as const;
type LeasedKind = keyof typeof COLUMN;

const idBase = (kind: WorldEntityKind): number => (KIND_CODES[kind] << KIND_SHIFT) >>> 0;

/**
 * Аренда блоков номеров `EntityId` в `shard_entity_sequences`; номера героев выдаёт P05.
 * Граница при старте поднимается выше всех существующих записей, включая надгробия.
 */
export class DbIdLeaseProvider implements IdLeaseProvider {
  constructor(
    private readonly db: Database,
    private readonly shardId: string,
    private readonly onFill?: (kind: WorldEntityKind, percent: 80 | 95) => void,
  ) {}

  /** Восстановление границ: `max(saved, maxExisting + 1)` по каждому виду. */
  async recover(): Promise<Record<LeasedKind, number>> {
    const out = {} as Record<LeasedKind, number>;
    await this.db
      .insert(shardEntitySequences)
      .values({ shardId: this.shardId })
      .onConflictDoNothing();
    for (const kind of Object.keys(COLUMN) as LeasedKind[]) {
      const base = idBase(kind);
      const [row] = await this.db
        .select({ max: sql<string | null>`max(${worldEntities.entityId})` })
        .from(worldEntities)
        .where(
          and(
            eq(worldEntities.shardId, this.shardId),
            sql`${worldEntities.entityId} BETWEEN ${base} AND ${base + MAX_SEQ}`,
          ),
        );
      const maxSeq = row?.max ? Number(row.max) - base : 0;
      const [updated] = await this.db
        .execute<{ next: number }>(
          sql`UPDATE shard_entity_sequences SET ${sql.raw(COLUMN_NAME[kind])} = GREATEST(${sql.raw(COLUMN_NAME[kind])}, ${maxSeq + 1})
            WHERE shard_id = ${this.shardId} RETURNING ${sql.raw(COLUMN_NAME[kind])} AS next`,
        )
        .then((r) => r.rows);
      out[kind] = Number(updated?.next ?? 1);
    }
    return out;
  }

  async lease(kind: WorldEntityKind, size: number): Promise<IdLease> {
    checkLeaseSize(size);
    if (kind === 'hero')
      throw new WorldStoreError('PERSIST_ENTITY_ID_RANGE_EXHAUSTED', 'номера героев выдаёт P05');
    const column = COLUMN_NAME[kind as LeasedKind];
    const rows = await this.db.execute<{ from: number; to: number }>(
      sql`UPDATE shard_entity_sequences AS t SET ${sql.raw(column)} = LEAST(o.prev + ${size}, ${MAX_SEQ + 1})
          FROM (SELECT ${sql.raw(column)} AS prev FROM shard_entity_sequences WHERE shard_id = ${this.shardId} FOR UPDATE) AS o
          WHERE t.shard_id = ${this.shardId} AND o.prev <= ${MAX_SEQ}
          RETURNING o.prev AS "from", t.${sql.raw(column)} AS "to"`,
    );
    const row = rows.rows[0] as { from: number; to: number } | undefined;
    if (!row)
      throw new WorldStoreError('PERSIST_ENTITY_ID_RANGE_EXHAUSTED', `${kind}: диапазон исчерпан`);
    const from = Number(row.from);
    const to = Number(row.to);
    const used = (to - 1) / MAX_SEQ;
    if (used >= 0.95) this.onFill?.(kind, 95);
    else if (used >= 0.8) this.onFill?.(kind, 80);
    return { kind, from, to };
  }
}

export interface PartitionLeaseInfo {
  epoch: number;
  expiresAt: Date;
}

/** Аренда партиции с эпохой: захват истёкшей или свободной, продление, проверка. */
export class PartitionLeaseRepo {
  constructor(
    private readonly db: Database,
    private readonly shardId: string,
    private readonly partitionId: string,
  ) {}

  async acquire(nodeId: string, ttlMs: number, now = new Date()): Promise<PartitionLeaseInfo> {
    const expiresAt = new Date(now.getTime() + ttlMs);
    const rows = await this.db.execute<{ epoch: string; expires_at: Date }>(
      sql`INSERT INTO partition_leases (shard_id, partition_id, owner_node_id, epoch, acquired_at, expires_at)
          VALUES (${this.shardId}, ${this.partitionId}, ${nodeId}, 1, ${now}, ${expiresAt})
          ON CONFLICT (shard_id, partition_id) DO UPDATE
            SET owner_node_id = excluded.owner_node_id, epoch = partition_leases.epoch + 1,
                acquired_at = excluded.acquired_at, expires_at = excluded.expires_at
            WHERE partition_leases.expires_at < ${now} OR partition_leases.owner_node_id = excluded.owner_node_id
          RETURNING epoch, expires_at`,
    );
    const row = rows.rows[0];
    if (row) return { epoch: Number(row.epoch), expiresAt: new Date(row.expires_at) };
    const [held] = await this.db
      .select()
      .from(partitionLeases)
      .where(
        and(
          eq(partitionLeases.shardId, this.shardId),
          eq(partitionLeases.partitionId, this.partitionId),
        ),
      );
    throw new WorldStoreError('PERSIST_PARTITION_LEASE_HELD', 'партиция занята', {
      ownerNodeId: held?.ownerNodeId,
      leaseExpiresAt: held?.expiresAt.toISOString(),
    });
  }

  /** Продление; `false` — эпоха устарела (партицию захватил другой узел). */
  async renew(epoch: number, ttlMs: number, now = new Date()): Promise<boolean> {
    const rows = await this.db
      .update(partitionLeases)
      .set({ expiresAt: new Date(now.getTime() + ttlMs) })
      .where(
        and(
          eq(partitionLeases.shardId, this.shardId),
          eq(partitionLeases.partitionId, this.partitionId),
          eq(partitionLeases.epoch, epoch),
        ),
      )
      .returning({ epoch: partitionLeases.epoch });
    return rows.length === 1;
  }

  /** Проверка эпохи внутри транзакции записи (блокирует строку от смены владельца). */
  async assertEpoch(tx: Executor, epoch: number): Promise<void> {
    const rows = await tx.execute<{ epoch: string }>(
      sql`SELECT epoch FROM partition_leases WHERE shard_id = ${this.shardId} AND partition_id = ${this.partitionId} FOR SHARE`,
    );
    const current = rows.rows[0] ? Number(rows.rows[0].epoch) : null;
    if (current !== epoch) {
      throw new WorldStoreError('PERSIST_FENCING_TOKEN_STALE', 'эпоха партиции устарела', {
        epoch,
        current,
      });
    }
  }

  async release(epoch: number): Promise<void> {
    await this.db
      .update(partitionLeases)
      .set({ expiresAt: new Date(0) })
      .where(
        and(
          eq(partitionLeases.shardId, this.shardId),
          eq(partitionLeases.partitionId, this.partitionId),
          eq(partitionLeases.epoch, epoch),
        ),
      );
  }
}

export type WorldInsert = typeof worldEntities.$inferInsert;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Потоковая загрузка партиции: сущности на земле плана в границах и их содержимое
 * (по `root_owner_id`), пакетами по `batch` строк в порядке `entity_id`.
 */
export async function* streamPartition(
  db: Database,
  shardId: string,
  realm: string,
  bounds: Bounds,
  batch = 5_000,
): AsyncGenerator<WorldRow[]> {
  let after = -1;
  for (;;) {
    const roots = await db
      .select()
      .from(worldEntities)
      .where(
        and(
          eq(worldEntities.shardId, shardId),
          eq(worldEntities.placement, 'world'),
          eq(worldEntities.realm, realm),
          sql`${worldEntities.x} BETWEEN ${bounds.minX} AND ${bounds.maxX}`,
          sql`${worldEntities.y} BETWEEN ${bounds.minY} AND ${bounds.maxY}`,
          isNull(worldEntities.deletedAt),
          gt(worldEntities.entityId, after),
        ),
      )
      .orderBy(asc(worldEntities.entityId))
      .limit(batch);
    if (roots.length === 0) return;
    after = (roots.at(-1) as WorldRow).entityId;
    const ids = roots.map((r) => r.entityId);
    const children = await db
      .select()
      .from(worldEntities)
      .where(
        and(
          eq(worldEntities.shardId, shardId),
          inArray(worldEntities.rootOwnerId, ids),
          sql`${worldEntities.placement} <> 'world'`,
          isNull(worldEntities.deletedAt),
        ),
      )
      .orderBy(asc(worldEntities.entityId));
    yield [...roots, ...children];
    if (roots.length < batch) return;
  }
}

/** Дерево владения героя или постройки одним запросом. */
export async function loadOwnedTree(
  db: Executor,
  shardId: string,
  ownerId: number,
): Promise<WorldRow[]> {
  return db
    .select()
    .from(worldEntities)
    .where(
      and(
        eq(worldEntities.shardId, shardId),
        eq(worldEntities.rootOwnerId, ownerId),
        isNull(worldEntities.deletedAt),
      ),
    )
    .orderBy(asc(worldEntities.entityId));
}

/** Строка пакета: новое состояние и ожидаемая версия в БД (`0` — вставка). */
export interface WriteRow {
  row: Omit<WorldInsert, 'entityVersion'>;
  expectedVersion: number;
}

export interface WriteResult {
  written: number[];
  /** Пропущенные: версия в БД другая (критическая транзакция успела раньше) или повтор идентификатора. */
  conflicts: number[];
}

/**
 * Пакетная запись одним оператором: вставка или обновление при совпадении версии.
 * Строки без совпадения не пишутся и возвращаются как конфликты.
 */
export async function writeBatch(tx: Executor, rows: readonly WriteRow[]): Promise<WriteResult> {
  if (rows.length === 0) return { written: [], conflicts: [] };
  const values = rows.map(({ row, expectedVersion }) => ({
    ...row,
    entityVersion: expectedVersion + 1,
  }));
  const written = await tx
    .insert(worldEntities)
    .values(values)
    .onConflictDoUpdate({
      target: [worldEntities.shardId, worldEntities.entityId],
      set: {
        kind: sql`excluded.kind`,
        contentKey: sql`excluded.content_key`,
        placement: sql`excluded.placement`,
        realm: sql`excluded.realm`,
        x: sql`excluded.x`,
        y: sql`excluded.y`,
        h: sql`excluded.h`,
        parentId: sql`excluded.parent_id`,
        slot: sql`excluded.slot`,
        rootOwnerId: sql`excluded.root_owner_id`,
        rect: sql`excluded.rect`,
        amount: sql`excluded.amount`,
        components: sql`excluded.components`,
        schemaVersion: sql`excluded.schema_version`,
        entityVersion: sql`excluded.entity_version`,
        changeSeq: sql`excluded.change_seq`,
        updatedAt: sql`excluded.updated_at`,
        deletedAt: sql`excluded.deleted_at`,
      },
      setWhere: sql`${worldEntities.entityVersion} = excluded.entity_version - 1 AND excluded.entity_version > 1`,
    })
    .returning({ id: worldEntities.entityId });
  const ok = new Set(written.map((w) => w.id));
  return {
    written: [...ok],
    conflicts: rows.map((r) => r.row.entityId).filter((id) => !ok.has(id)),
  };
}

export type ShardWorldStateRow = typeof shardWorldState.$inferSelect;
export type WorldTimerRow = typeof worldTimers.$inferSelect;

/** Идемпотентная инициализация состояния шарда; возвращает действующую запись. */
export async function initShardState(
  db: Database,
  init: { shardId: string; worldVersion: string; rulesetFingerprint: string; rngState: string },
  now = new Date(),
): Promise<ShardWorldStateRow> {
  await db
    .insert(shardWorldState)
    .values({ ...init, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(shardWorldState)
    .where(eq(shardWorldState.shardId, init.shardId));
  return row as ShardWorldStateRow;
}

export async function saveShardState(
  db: Executor,
  shardId: string,
  patch: Partial<Omit<ShardWorldStateRow, 'shardId' | 'createdAt'>>,
  now = new Date(),
): Promise<void> {
  await db
    .update(shardWorldState)
    .set({ ...patch, updatedAt: now })
    .where(eq(shardWorldState.shardId, shardId));
}

export const listTimers = (db: Executor, shardId: string): Promise<WorldTimerRow[]> =>
  db
    .select()
    .from(worldTimers)
    .where(eq(worldTimers.shardId, shardId))
    .orderBy(asc(worldTimers.dueAt));

export async function insertTimer(
  db: Executor,
  row: typeof worldTimers.$inferInsert,
): Promise<void> {
  await db.insert(worldTimers).values(row);
}

export async function deleteTimer(db: Executor, id: string): Promise<void> {
  await db.delete(worldTimers).where(eq(worldTimers.id, id));
}

/** Остаток таймеров при остановке: `pause` переживает простой. */
export async function saveTimerRemaining(
  db: Executor,
  rows: readonly { id: string; remainingMs: number; dueAt: Date }[],
): Promise<void> {
  for (const r of rows) {
    await db
      .update(worldTimers)
      .set({ remainingMs: r.remainingMs, dueAt: r.dueAt })
      .where(eq(worldTimers.id, r.id));
  }
}

/** Мягкое удаление пакетом при совпадении версии; возвращает удалённые идентификаторы. */
export async function softDeleteBatch(
  tx: Executor,
  shardId: string,
  rows: readonly { entityId: number; expectedVersion: number }[],
  now = new Date(),
): Promise<number[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.entityId);
  const versions = rows.map((r) => r.expectedVersion);
  const result = await tx.execute<{ entity_id: string }>(
    sql`UPDATE world_entities AS w SET deleted_at = ${now}, updated_at = ${now}, entity_version = w.entity_version + 1
        FROM unnest(${sql.param(ids)}::bigint[], ${sql.param(versions)}::int[]) AS v(id, ver)
        WHERE w.shard_id = ${shardId} AND w.entity_id = v.id AND w.entity_version = v.ver AND w.deleted_at IS NULL
        RETURNING w.entity_id`,
  );
  return result.rows.map((r) => Number(r.entity_id));
}

export type LedgerInsert = Omit<typeof itemLedger.$inferInsert, 'ledgerSeq'>;
export type CriticalTxRow = typeof criticalTransactions.$inferSelect;

export const findCriticalTx = async (
  db: Executor,
  shardId: string,
  idempotencyKey: string,
): Promise<CriticalTxRow | undefined> =>
  (
    await db
      .select()
      .from(criticalTransactions)
      .where(
        and(
          eq(criticalTransactions.shardId, shardId),
          eq(criticalTransactions.idempotencyKey, idempotencyKey),
        ),
      )
  )[0];

export interface CriticalCommit {
  shardId: string;
  txId: string;
  txType: string;
  idempotencyKey: string | null;
  payloadHash: string;
  actorAccountId: string | null;
  /** Несохранённые фоновые изменения участников — в той же транзакции. */
  prior: WriteRow[];
  upserts: WriteRow[];
  deletes: { entityId: number; expectedVersion: number }[];
  ledger: LedgerInsert[];
  result: Record<string, unknown>;
  now: Date;
  /** Проверка эпохи партиции внутри транзакции. */
  assertEpoch: (tx: Executor) => Promise<void>;
  /** Выдача стартового набора: флаг героя ставится только если ещё не стоит. */
  grantStarterFor?: string | null;
}

/**
 * Критическая транзакция одной ACID-единицей: реестр, предварительные изменения, план, удаления, журнал.
 * Любое расхождение версий откатывает всё (`PERSIST_TX_CONFLICT`).
 */
export async function commitCritical(db: Database, c: CriticalCommit): Promise<void> {
  await db.transaction(async (tx) => {
    await c.assertEpoch(tx);
    await tx.insert(criticalTransactions).values({
      txId: c.txId,
      shardId: c.shardId,
      txType: c.txType,
      idempotencyKey: c.idempotencyKey,
      payloadHash: c.payloadHash,
      status: 'committed',
      result: c.result,
      actorAccountId: c.actorAccountId,
      createdAt: c.now,
      committedAt: c.now,
    });
    const prior = await writeBatch(tx, c.prior);
    if (prior.conflicts.length > 0) {
      throw new WorldStoreError('PERSIST_TX_CONFLICT', 'версии участников изменились', {
        entityIds: prior.conflicts,
      });
    }
    const main = await writeBatch(tx, c.upserts);
    if (main.conflicts.length > 0) {
      throw new WorldStoreError('PERSIST_TX_CONFLICT', 'версии участников изменились', {
        entityIds: main.conflicts,
      });
    }
    const deleted = await softDeleteBatch(tx, c.shardId, c.deletes, c.now);
    if (deleted.length !== c.deletes.length) {
      throw new WorldStoreError('PERSIST_TX_CONFLICT', 'удаляемые предметы изменились', {
        entityIds: c.deletes.map((d) => d.entityId).filter((id) => !deleted.includes(id)),
      });
    }
    if (c.ledger.length > 0) await tx.insert(itemLedger).values(c.ledger);
    if (c.grantStarterFor) {
      const granted = await tx
        .update(characters)
        .set({ starterLoadoutGranted: true })
        .where(
          and(eq(characters.id, c.grantStarterFor), eq(characters.starterLoadoutGranted, false)),
        )
        .returning({ id: characters.id });
      if (granted.length !== 1) {
        throw new WorldStoreError('PERSIST_TX_CONFLICT', 'стартовый набор уже выдан', {
          characterId: c.grantStarterFor,
        });
      }
    }
  });
}

/** Секции журнала текущего и следующего месяца. */
export async function ensureLedgerMonths(db: Executor, now = new Date()): Promise<void> {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  await db.execute(sql`SELECT item_ledger_ensure_month(${now.toISOString().slice(0, 10)}::date)`);
  await db.execute(sql`SELECT item_ledger_ensure_month(${next.toISOString().slice(0, 10)}::date)`);
}

export type LedgerRow = typeof itemLedger.$inferSelect;

/** История предмета по порядку `ledger_seq`. */
export const ledgerOfItem = (db: Executor, shardId: string, itemId: number): Promise<LedgerRow[]> =>
  db
    .select()
    .from(itemLedger)
    .where(and(eq(itemLedger.shardId, shardId), eq(itemLedger.itemId, itemId)))
    .orderBy(asc(itemLedger.ledgerSeq));

/**
 * Цепочка происхождения: предмет, его источники вверх по `source_item_id`
 * и производные стопки вниз, затем история всех звеньев.
 */
export async function ledgerLineage(
  db: Executor,
  shardId: string,
  itemId: number,
): Promise<{ items: number[]; events: LedgerRow[] }> {
  const rows = await db.execute<{ item_id: string }>(sql`
    WITH RECURSIVE up(item_id, depth) AS (
      SELECT ${itemId}::bigint, 0
      UNION
      SELECT l.source_item_id, up.depth + 1 FROM item_ledger l JOIN up ON l.item_id = up.item_id
      WHERE l.shard_id = ${shardId} AND l.source_item_id IS NOT NULL AND up.depth < 32
    ),
    down(item_id, depth) AS (
      SELECT ${itemId}::bigint, 0
      UNION
      SELECT l.item_id, down.depth + 1 FROM item_ledger l JOIN down ON l.source_item_id = down.item_id
      WHERE l.shard_id = ${shardId} AND down.depth < 32
    )
    SELECT item_id FROM up UNION SELECT item_id FROM down`);
  const items = [...new Set(rows.rows.map((r) => Number(r.item_id)))].sort((a, b) => a - b);
  const events = await db
    .select()
    .from(itemLedger)
    .where(and(eq(itemLedger.shardId, shardId), inArray(itemLedger.itemId, items)))
    .orderBy(asc(itemLedger.ledgerSeq));
  return { items, events };
}

export interface LedgerFilter {
  characterId?: string;
  accountId?: string;
  txId?: string;
  from?: Date;
  to?: Date;
  /** Курсор — последний выданный `ledger_seq`. */
  after?: number;
  limit: number;
}

/** События по герою, исполнителю или транзакции за период с курсорной выдачей. */
export async function ledgerQuery(
  db: Executor,
  shardId: string,
  f: LedgerFilter,
): Promise<{ events: LedgerRow[]; next: number | null }> {
  const conditions = [eq(itemLedger.shardId, shardId)];
  if (f.characterId) conditions.push(eq(itemLedger.characterId, f.characterId));
  if (f.accountId) conditions.push(eq(itemLedger.actorAccountId, f.accountId));
  if (f.txId) conditions.push(eq(itemLedger.txId, f.txId));
  if (f.from) conditions.push(sql`${itemLedger.createdAt} >= ${f.from}`);
  if (f.to) conditions.push(sql`${itemLedger.createdAt} < ${f.to}`);
  if (f.after !== undefined) conditions.push(gt(itemLedger.ledgerSeq, f.after));
  const events = await db
    .select()
    .from(itemLedger)
    .where(and(...conditions))
    .orderBy(asc(itemLedger.ledgerSeq))
    .limit(f.limit + 1);
  const more = events.length > f.limit;
  const page = events.slice(0, f.limit);
  return { events: page, next: more ? (page.at(-1)?.ledgerSeq ?? null) : null };
}

export type BackupRow = typeof backupCatalog.$inferSelect;

/** Каталог резервных копий. */
export const backups = {
  insert: async (db: Executor, row: typeof backupCatalog.$inferInsert) =>
    void (await db.insert(backupCatalog).values(row)),
  update: async (db: Executor, id: string, patch: Partial<typeof backupCatalog.$inferInsert>) =>
    void (await db.update(backupCatalog).set(patch).where(eq(backupCatalog.id, id))),
  get: async (db: Executor, id: string): Promise<BackupRow | undefined> =>
    (await db.select().from(backupCatalog).where(eq(backupCatalog.id, id)))[0],
  latestUsable: async (db: Executor): Promise<BackupRow | undefined> =>
    (
      await db
        .select()
        .from(backupCatalog)
        .where(sql`${backupCatalog.status} IN ('completed', 'verified')`)
        .orderBy(sql`${backupCatalog.createdAt} DESC`)
        .limit(1)
    )[0],
  expired: (db: Executor, now: Date): Promise<BackupRow[]> =>
    db
      .select()
      .from(backupCatalog)
      .where(
        sql`${backupCatalog.retentionUntil} < ${now} AND ${backupCatalog.status} IN ('completed', 'verified')`,
      ),
};

/** Именованная точка восстановления; повтор имени — `PERSIST_RESTORE_POINT_EXISTS`. */
export async function insertRestorePoint(
  db: Executor,
  row: typeof restorePoints.$inferInsert,
): Promise<void> {
  const inserted = await db
    .insert(restorePoints)
    .values(row)
    .onConflictDoNothing()
    .returning({ name: restorePoints.name });
  if (inserted.length === 0)
    throw new WorldStoreError('PERSIST_RESTORE_POINT_EXISTS', `точка ${row.name} уже есть`);
}

/** Точка восстановления в WAL и её запись в реестре. */
export async function createRestorePoint(
  db: Database,
  row: Omit<typeof restorePoints.$inferInsert, 'lsn' | 'createdAt'>,
  now = new Date(),
): Promise<{ lsn: string }> {
  const exists = await db
    .select({ name: restorePoints.name })
    .from(restorePoints)
    .where(and(eq(restorePoints.shardId, row.shardId), eq(restorePoints.name, row.name)));
  if (exists.length > 0)
    throw new WorldStoreError('PERSIST_RESTORE_POINT_EXISTS', `точка ${row.name} уже есть`);
  const created = await db.execute<{ lsn: string }>(
    sql`SELECT pg_create_restore_point(${row.name})::text AS lsn`,
  );
  const lsn = created.rows[0]?.lsn ?? '';
  await insertRestorePoint(db, { ...row, lsn, createdAt: now });
  return { lsn };
}
export * from './restore.js';
