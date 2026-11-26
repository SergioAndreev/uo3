import { sql } from 'drizzle-orm';
import {
  boolean,
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

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Реестр шардов. */
export const shards = pgTable('shards', {
  id: varchar('id', { length: 32 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  region: varchar('region', { length: 32 }).notNull(),
  preset: varchar('preset', { length: 16 }).notNull(),
  rulesetOverride: jsonb('ruleset_override').notNull().default({}),
  visibility: varchar('visibility', { length: 16 }).notNull().default('public'),
  manualStatus: varchar('manual_status', { length: 16 }).notNull().default('normal'),
  maintenanceEta: at('maintenance_eta'),
  maintenanceMessage: text('maintenance_message'),
  creationOpen: boolean('creation_open').notNull().default(true),
  characterSlots: smallint('character_slots').notNull().default(5),
  renamePolicy: varchar('rename_policy', { length: 16 }).notNull().default('cooldown'),
  ticketTtlS: smallint('ticket_ttl_s').notNull().default(30),
  softCapacity: integer('soft_capacity').notNull().default(1000),
  hardCapacity: integer('hard_capacity').notNull().default(1200),
  staffBuffer: integer('staff_buffer').notNull().default(20),
  protocolRange: varchar('protocol_range', { length: 64 }).notNull().default('>=0.1.0 <1.0.0'),
  startCities: text('start_cities').array().notNull(),
  sortOrder: integer('sort_order').notNull().default(100),
  createdAt: at('created_at').notNull(),
  updatedAt: at('updated_at').notNull(),
  archivedAt: at('archived_at'),
});

/** Последовательность номеров героев шарда (`EntityId` вида hero). */
export const shardEntitySequences = pgTable('shard_entity_sequences', {
  shardId: varchar('shard_id', { length: 32 })
    .primaryKey()
    .references(() => shards.id, { onDelete: 'cascade' }),
  nextHero: integer('next_hero').notNull().default(1),
});

export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey(),
    shardId: varchar('shard_id', { length: 32 })
      .notNull()
      .references(() => shards.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    entityId: integer('entity_id').notNull(),
    slot: smallint('slot').notNull(),
    name: varchar('name', { length: 32 }).notNull(),
    nameKey: varchar('name_key', { length: 32 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    stats: jsonb('stats').notNull(),
    appearance: jsonb('appearance').notNull(),
    background: varchar('background', { length: 32 }),
    startCity: varchar('start_city', { length: 32 }).notNull(),
    realm: varchar('realm', { length: 32 }).notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    h: smallint('h').notNull(),
    starterLoadout: jsonb('starter_loadout').notNull(),
    createdAt: at('created_at').notNull(),
    lastPlayedAt: at('last_played_at'),
    deleteAt: at('delete_at'),
    deletedAt: at('deleted_at'),
    statusBeforeDeletion: varchar('status_before_deletion', { length: 24 }),
    renamedAt: at('renamed_at'),
    lockReason: text('lock_reason'),
    /** Текущие ресурсы; `null` — полные (герой ещё не входил в мир). */
    health: integer('health'),
    verve: integer('verve'),
    resonance: integer('resonance'),
    playtimeSeconds: integer('playtime_seconds').notNull().default(0),
  },
  (t) => [
    uniqueIndex('characters_name_live_idx')
      .on(t.shardId, t.nameKey)
      .where(sql`${t.status} <> 'deleted'`),
    uniqueIndex('characters_slot_live_idx')
      .on(t.accountId, t.shardId, t.slot)
      .where(sql`${t.status} <> 'deleted'`),
    uniqueIndex('characters_entity_idx').on(t.shardId, t.entityId),
    index('characters_account_idx').on(t.accountId, t.shardId),
    index('characters_delete_due_idx').on(t.status, t.deleteAt),
  ],
);

export const characterSkills = pgTable(
  'character_skills',
  {
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    skill: varchar('skill', { length: 32 }).notNull(),
    tenths: smallint('tenths').notNull(),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.skill] })],
);

export const characterNameHistory = pgTable(
  'character_name_history',
  {
    id: uuid('id').primaryKey(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    oldName: varchar('old_name', { length: 32 }).notNull(),
    newName: varchar('new_name', { length: 32 }).notNull(),
    reason: varchar('reason', { length: 32 }).notNull(),
    changedBy: uuid('changed_by').notNull(),
    at: at('at').notNull(),
  },
  (t) => [index('character_name_history_idx').on(t.characterId, t.at)],
);

/** Удержание имени развитого героя за прежним аккаунтом после удаления. */
export const characterNameHolds = pgTable(
  'character_name_holds',
  {
    shardId: varchar('shard_id', { length: 32 }).notNull(),
    nameKey: varchar('name_key', { length: 32 }).notNull(),
    accountId: uuid('account_id').notNull(),
    until: at('until').notNull(),
  },
  (t) => [primaryKey({ columns: [t.shardId, t.nameKey] })],
);

export const accountShardEntitlements = pgTable(
  'account_shard_entitlements',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    shardId: varchar('shard_id', { length: 32 })
      .notNull()
      .references(() => shards.id, { onDelete: 'cascade' }),
    extraSlots: smallint('extra_slots').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.shardId] })],
);
