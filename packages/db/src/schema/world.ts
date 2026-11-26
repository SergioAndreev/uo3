import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { accounts } from './identity.js';
import { characters, shards } from './shards.js';

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const id = (name: string) => bigint(name, { mode: 'number' });
const shardRef = () =>
  varchar('shard_id', { length: 32 })
    .notNull()
    .references(() => shards.id);

/** Персистентные сущности мира: существа, предметы, постройки (герои — в `characters`). */
export const worldEntities = pgTable(
  'world_entities',
  {
    shardId: shardRef(),
    entityId: id('entity_id').notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    contentKey: varchar('content_key', { length: 64 }).notNull(),
    placement: varchar('placement', { length: 12 }).notNull(),
    realm: varchar('realm', { length: 32 }),
    x: integer('x'),
    y: integer('y'),
    h: smallint('h'),
    /** Контейнер, держатель снаряжения или владелец банка. */
    parentId: id('parent_id'),
    slot: varchar('slot', { length: 16 }),
    /** Владелец дерева (герой или постройка) — загрузка героя одним запросом. */
    rootOwnerId: id('root_owner_id'),
    /** Прямоугольник постройки. */
    rect: jsonb('rect'),
    amount: integer('amount').notNull().default(1),
    components: jsonb('components').notNull().default({}),
    schemaVersion: integer('schema_version').notNull().default(1),
    entityVersion: integer('entity_version').notNull().default(1),
    changeSeq: bigint('change_seq', { mode: 'number' }).notNull().default(0),
    createdAt: at('created_at').notNull(),
    updatedAt: at('updated_at').notNull(),
    deletedAt: at('deleted_at'),
  },
  (t) => [
    primaryKey({ columns: [t.shardId, t.entityId] }),
    uniqueIndex('world_entities_equipped_slot_idx')
      .on(t.shardId, t.parentId, t.slot)
      .where(sql`${t.placement} = 'equipped' AND ${t.deletedAt} IS NULL`),
    index('world_entities_ground_idx')
      .on(t.shardId, t.realm, t.x, t.y)
      .where(sql`${t.placement} = 'world' AND ${t.deletedAt} IS NULL`),
    index('world_entities_owner_idx').on(t.shardId, t.rootOwnerId),
    index('world_entities_parent_idx').on(t.shardId, t.parentId),
    check('world_entities_kind', sql`${t.kind} IN ('creature', 'item', 'structure')`),
    check(
      'world_entities_placement',
      sql`${t.placement} IN ('world', 'container', 'equipped', 'bank', 'limbo')`,
    ),
    check(
      'world_entities_world_coords',
      sql`${t.placement} <> 'world' OR (${t.realm} IS NOT NULL AND ${t.x} IS NOT NULL AND ${t.y} IS NOT NULL AND ${t.h} IS NOT NULL AND ${t.parentId} IS NULL)`,
    ),
    check(
      'world_entities_parent',
      sql`${t.placement} NOT IN ('container', 'equipped', 'bank') OR ${t.parentId} IS NOT NULL`,
    ),
    check('world_entities_slot', sql`${t.placement} <> 'equipped' OR ${t.slot} IS NOT NULL`),
    check(
      'world_entities_versions',
      sql`${t.entityVersion} >= 1 AND ${t.schemaVersion} >= 1 AND ${t.amount} >= 1`,
    ),
  ],
);

/** Мировое состояние героя сверх строки P05. */
export const heroWorldState = pgTable('hero_world_state', {
  characterId: uuid('character_id')
    .primaryKey()
    .references(() => characters.id, { onDelete: 'cascade' }),
  shardId: shardRef(),
  skills: jsonb('skills').notNull().default({}),
  flags: jsonb('flags').notNull().default({}),
  entityVersion: integer('entity_version').notNull().default(1),
  updatedAt: at('updated_at').notNull(),
});

/** Состояние шарда: время, ГПСЧ, версии, контрольная точка. */
export const shardWorldState = pgTable('shard_world_state', {
  shardId: varchar('shard_id', { length: 32 })
    .primaryKey()
    .references(() => shards.id),
  worldVersion: varchar('world_version', { length: 64 }).notNull(),
  rulesetFingerprint: varchar('ruleset_fingerprint', { length: 64 }).notNull(),
  gameTimeMs: bigint('game_time_ms', { mode: 'number' }).notNull().default(0),
  rngState: varchar('rng_state', { length: 128 }).notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  checkpointSeq: bigint('checkpoint_seq', { mode: 'number' }).notNull().default(0),
  lastFlushAt: at('last_flush_at'),
  stoppedAt: at('stopped_at'),
  createdAt: at('created_at').notNull(),
  updatedAt: at('updated_at').notNull(),
});

/** Длительные таймеры (распад, появление существ). */
export const worldTimers = pgTable(
  'world_timers',
  {
    id: uuid('id').primaryKey(),
    shardId: shardRef(),
    entityId: id('entity_id'),
    kind: varchar('kind', { length: 32 }).notNull(),
    /** `pause` — продлевается на простой; `wall` — по реальному времени; `staggered` — просроченные распределяются. */
    policy: varchar('policy', { length: 16 }).notNull(),
    remainingMs: bigint('remaining_ms', { mode: 'number' }).notNull(),
    dueAt: at('due_at').notNull(),
    payload: jsonb('payload').notNull().default({}),
    createdAt: at('created_at').notNull(),
  },
  (t) => [
    index('world_timers_shard_idx').on(t.shardId, t.dueAt),
    check('world_timers_policy', sql`${t.policy} IN ('pause', 'wall', 'staggered')`),
  ],
);

/** Аренда партиции с эпохой (fencing). */
export const partitionLeases = pgTable(
  'partition_leases',
  {
    shardId: shardRef(),
    partitionId: varchar('partition_id', { length: 32 }).notNull(),
    ownerNodeId: varchar('owner_node_id', { length: 64 }).notNull(),
    epoch: bigint('epoch', { mode: 'number' }).notNull(),
    acquiredAt: at('acquired_at').notNull(),
    expiresAt: at('expires_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.shardId, t.partitionId] })],
);

/** Журнал предметов: только добавление (триггер), секции по месяцам (миграция). */
export const itemLedger = pgTable(
  'item_ledger',
  {
    shardId: varchar('shard_id', { length: 32 }).notNull(),
    ledgerSeq: bigserial('ledger_seq', { mode: 'number' }).notNull(),
    createdAt: at('created_at').notNull(),
    txId: uuid('tx_id').notNull(),
    txType: varchar('tx_type', { length: 32 }).notNull(),
    eventKind: varchar('event_kind', { length: 16 }).notNull(),
    itemId: id('item_id').notNull(),
    sourceItemId: id('source_item_id'),
    amountDelta: integer('amount_delta').notNull().default(0),
    fromOwnerId: id('from_owner_id'),
    toOwnerId: id('to_owner_id'),
    fromParentId: id('from_parent_id'),
    toParentId: id('to_parent_id'),
    actorAccountId: uuid('actor_account_id'),
    actorAccessLevel: varchar('actor_access_level', { length: 16 }),
    characterId: uuid('character_id'),
    realm: varchar('realm', { length: 32 }),
    x: integer('x'),
    y: integer('y'),
    h: smallint('h'),
    reasonCode: varchar('reason_code', { length: 64 }),
    details: jsonb('details').notNull().default({}),
  },
  (t) => [
    primaryKey({ columns: [t.shardId, t.ledgerSeq, t.createdAt] }),
    index('item_ledger_item_idx').on(t.shardId, t.itemId, t.ledgerSeq),
    index('item_ledger_source_idx').on(t.shardId, t.sourceItemId),
    index('item_ledger_actor_idx').on(t.shardId, t.actorAccountId, t.createdAt),
    index('item_ledger_character_idx').on(t.shardId, t.characterId, t.createdAt),
    index('item_ledger_tx_idx').on(t.shardId, t.txId),
  ],
);

/** Реестр критических транзакций (идемпотентность). */
export const criticalTransactions = pgTable(
  'critical_transactions',
  {
    txId: uuid('tx_id').primaryKey(),
    shardId: shardRef(),
    txType: varchar('tx_type', { length: 32 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    result: jsonb('result').notNull().default({}),
    actorAccountId: uuid('actor_account_id'),
    createdAt: at('created_at').notNull(),
    committedAt: at('committed_at'),
  },
  (t) => [
    uniqueIndex('critical_transactions_key_idx')
      .on(t.shardId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
  ],
);

/** Операции точечного восстановления с снимками до и после. */
export const restoreOperations = pgTable(
  'restore_operations',
  {
    id: uuid('id').primaryKey(),
    shardId: shardRef(),
    kind: varchar('kind', { length: 16 }).notNull(),
    target: varchar('target', { length: 64 }).notNull(),
    targetTime: at('target_time'),
    mode: varchar('mode', { length: 24 }).notNull(),
    txId: uuid('tx_id'),
    beforeSnapshot: jsonb('before_snapshot').notNull(),
    afterSnapshot: jsonb('after_snapshot').notNull(),
    actorAccountId: uuid('actor_account_id')
      .notNull()
      .references(() => accounts.id),
    reason: text('reason').notNull(),
    undoOf: uuid('undo_of'),
    undoneAt: at('undone_at'),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at').notNull(),
  },
  (t) => [index('restore_operations_shard_idx').on(t.shardId, t.createdAt)],
);

/** Именованные точки восстановления. */
export const restorePoints = pgTable(
  'restore_points',
  {
    shardId: shardRef(),
    name: varchar('name', { length: 64 }).notNull(),
    lsn: varchar('lsn', { length: 32 }).notNull(),
    checkpointSeq: bigint('checkpoint_seq', { mode: 'number' }).notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => accounts.id),
    reason: text('reason').notNull(),
    createdAt: at('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.shardId, t.name] })],
);

/** Каталог резервных копий. */
export const backupCatalog = pgTable(
  'backup_catalog',
  {
    id: uuid('id').primaryKey(),
    kind: varchar('kind', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    location: text('location').notNull(),
    sha256: varchar('sha256', { length: 64 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    walStartLsn: varchar('wal_start_lsn', { length: 32 }),
    walEndLsn: varchar('wal_end_lsn', { length: 32 }),
    checkpointSeq: bigint('checkpoint_seq', { mode: 'number' }),
    encryptionKeyId: varchar('encryption_key_id', { length: 64 }),
    retentionUntil: at('retention_until').notNull(),
    createdAt: at('created_at').notNull(),
    completedAt: at('completed_at'),
    verifiedAt: at('verified_at'),
    report: jsonb('report').notNull().default({}),
  },
  (t) => [
    index('backup_catalog_status_idx').on(t.status, t.createdAt),
    check(
      'backup_catalog_status',
      sql`${t.status} IN ('running', 'completed', 'failed', 'verified', 'expired')`,
    ),
  ],
);
