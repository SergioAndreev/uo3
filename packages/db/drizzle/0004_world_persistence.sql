CREATE TABLE "backup_catalog" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"location" text NOT NULL,
	"sha256" varchar(64),
	"size_bytes" bigint,
	"wal_start_lsn" varchar(32),
	"wal_end_lsn" varchar(32),
	"checkpoint_seq" bigint,
	"encryption_key_id" varchar(64),
	"retention_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "backup_catalog_status" CHECK ("backup_catalog"."status" IN ('running', 'completed', 'failed', 'verified', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "critical_transactions" (
	"tx_id" uuid PRIMARY KEY NOT NULL,
	"shard_id" varchar(32) NOT NULL,
	"tx_type" varchar(32) NOT NULL,
	"idempotency_key" varchar(128),
	"payload_hash" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_account_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hero_world_state" (
	"character_id" uuid PRIMARY KEY NOT NULL,
	"shard_id" varchar(32) NOT NULL,
	"skills" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entity_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_ledger" (
	"shard_id" varchar(32) NOT NULL,
	"ledger_seq" bigserial NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"tx_id" uuid NOT NULL,
	"tx_type" varchar(32) NOT NULL,
	"event_kind" varchar(16) NOT NULL,
	"item_id" bigint NOT NULL,
	"source_item_id" bigint,
	"amount_delta" integer DEFAULT 0 NOT NULL,
	"from_owner_id" bigint,
	"to_owner_id" bigint,
	"from_parent_id" bigint,
	"to_parent_id" bigint,
	"actor_account_id" uuid,
	"actor_access_level" varchar(16),
	"character_id" uuid,
	"realm" varchar(32),
	"x" integer,
	"y" integer,
	"h" smallint,
	"reason_code" varchar(64),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "item_ledger_shard_id_ledger_seq_created_at_pk" PRIMARY KEY("shard_id","ledger_seq","created_at")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
CREATE TABLE "partition_leases" (
	"shard_id" varchar(32) NOT NULL,
	"partition_id" varchar(32) NOT NULL,
	"owner_node_id" varchar(64) NOT NULL,
	"epoch" bigint NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "partition_leases_shard_id_partition_id_pk" PRIMARY KEY("shard_id","partition_id")
);
--> statement-breakpoint
CREATE TABLE "restore_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shard_id" varchar(32) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"target" varchar(64) NOT NULL,
	"target_time" timestamp with time zone,
	"mode" varchar(24) NOT NULL,
	"tx_id" uuid,
	"before_snapshot" jsonb NOT NULL,
	"after_snapshot" jsonb NOT NULL,
	"actor_account_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"undo_of" uuid,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restore_points" (
	"shard_id" varchar(32) NOT NULL,
	"name" varchar(64) NOT NULL,
	"lsn" varchar(32) NOT NULL,
	"checkpoint_seq" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "restore_points_shard_id_name_pk" PRIMARY KEY("shard_id","name")
);
--> statement-breakpoint
CREATE TABLE "shard_world_state" (
	"shard_id" varchar(32) PRIMARY KEY NOT NULL,
	"world_version" varchar(64) NOT NULL,
	"ruleset_fingerprint" varchar(64) NOT NULL,
	"game_time_ms" bigint DEFAULT 0 NOT NULL,
	"rng_state" varchar(128) NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"checkpoint_seq" bigint DEFAULT 0 NOT NULL,
	"last_flush_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_entities" (
	"shard_id" varchar(32) NOT NULL,
	"entity_id" bigint NOT NULL,
	"kind" varchar(16) NOT NULL,
	"content_key" varchar(64) NOT NULL,
	"placement" varchar(12) NOT NULL,
	"realm" varchar(32),
	"x" integer,
	"y" integer,
	"h" smallint,
	"parent_id" bigint,
	"slot" varchar(16),
	"root_owner_id" bigint,
	"rect" jsonb,
	"amount" integer DEFAULT 1 NOT NULL,
	"components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"entity_version" integer DEFAULT 1 NOT NULL,
	"change_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "world_entities_shard_id_entity_id_pk" PRIMARY KEY("shard_id","entity_id"),
	CONSTRAINT "world_entities_kind" CHECK ("world_entities"."kind" IN ('creature', 'item', 'structure')),
	CONSTRAINT "world_entities_placement" CHECK ("world_entities"."placement" IN ('world', 'container', 'equipped', 'bank', 'limbo')),
	CONSTRAINT "world_entities_world_coords" CHECK ("world_entities"."placement" <> 'world' OR ("world_entities"."realm" IS NOT NULL AND "world_entities"."x" IS NOT NULL AND "world_entities"."y" IS NOT NULL AND "world_entities"."h" IS NOT NULL AND "world_entities"."parent_id" IS NULL)),
	CONSTRAINT "world_entities_parent" CHECK ("world_entities"."placement" NOT IN ('container', 'equipped', 'bank') OR "world_entities"."parent_id" IS NOT NULL),
	CONSTRAINT "world_entities_slot" CHECK ("world_entities"."placement" <> 'equipped' OR "world_entities"."slot" IS NOT NULL),
	CONSTRAINT "world_entities_versions" CHECK ("world_entities"."entity_version" >= 1 AND "world_entities"."schema_version" >= 1 AND "world_entities"."amount" >= 1)
);
--> statement-breakpoint
CREATE TABLE "world_timers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shard_id" varchar(32) NOT NULL,
	"entity_id" bigint,
	"kind" varchar(32) NOT NULL,
	"policy" varchar(16) NOT NULL,
	"remaining_ms" bigint NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "world_timers_policy" CHECK ("world_timers"."policy" IN ('pause', 'wall', 'staggered'))
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "starter_loadout_granted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shard_entity_sequences" ADD COLUMN "next_creature" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "shard_entity_sequences" ADD COLUMN "next_item" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "shard_entity_sequences" ADD COLUMN "next_structure" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "critical_transactions" ADD CONSTRAINT "critical_transactions_shard_id_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."shards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hero_world_state" ADD CONSTRAINT "hero_world_state_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hero_world_state" ADD CONSTRAINT "hero_world_state_shard_id_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."shards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partition_leases" ADD CONSTRAINT "partition_leases_shard_id_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."shards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_operations" ADD CONSTRAINT "restore_operations_shard_id_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."shards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_operations" ADD CONSTRAINT "restore_operations_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_points" ADD CONSTRAINT "restore_points_shard_id_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."shards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_points" ADD CONSTRAINT "restore_points_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shard_world_state" ADD CONSTRAINT "shard_world_state_shard_id_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."shards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_entities" ADD CONSTRAINT "world_entities_shard_id_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."shards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_timers" ADD CONSTRAINT "world_timers_shard_id_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."shards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_catalog_status_idx" ON "backup_catalog" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "critical_transactions_key_idx" ON "critical_transactions" USING btree ("shard_id","idempotency_key") WHERE "critical_transactions"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "item_ledger_item_idx" ON "item_ledger" USING btree ("shard_id","item_id","ledger_seq");--> statement-breakpoint
CREATE INDEX "item_ledger_source_idx" ON "item_ledger" USING btree ("shard_id","source_item_id");--> statement-breakpoint
CREATE INDEX "item_ledger_actor_idx" ON "item_ledger" USING btree ("shard_id","actor_account_id","created_at");--> statement-breakpoint
CREATE INDEX "item_ledger_character_idx" ON "item_ledger" USING btree ("shard_id","character_id","created_at");--> statement-breakpoint
CREATE INDEX "item_ledger_tx_idx" ON "item_ledger" USING btree ("shard_id","tx_id");--> statement-breakpoint
CREATE INDEX "restore_operations_shard_idx" ON "restore_operations" USING btree ("shard_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "world_entities_equipped_slot_idx" ON "world_entities" USING btree ("shard_id","parent_id","slot") WHERE "world_entities"."placement" = 'equipped' AND "world_entities"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "world_entities_ground_idx" ON "world_entities" USING btree ("shard_id","realm","x","y") WHERE "world_entities"."placement" = 'world' AND "world_entities"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "world_entities_owner_idx" ON "world_entities" USING btree ("shard_id","root_owner_id");--> statement-breakpoint
CREATE INDEX "world_entities_parent_idx" ON "world_entities" USING btree ("shard_id","parent_id");--> statement-breakpoint
CREATE INDEX "world_timers_shard_idx" ON "world_timers" USING btree ("shard_id","due_at");--> statement-breakpoint
CREATE TABLE "item_ledger_default" PARTITION OF "item_ledger" DEFAULT;--> statement-breakpoint
CREATE FUNCTION "item_ledger_ensure_month"(month date) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
	start date := date_trunc('month', month)::date;
	name text := 'item_ledger_' || to_char(start, 'YYYY_MM');
BEGIN
	IF to_regclass(name) IS NULL THEN
		EXECUTE format('CREATE TABLE %I PARTITION OF "item_ledger" FOR VALUES FROM (%L) TO (%L)', name, start, (start + interval '1 month')::date);
	END IF;
	RETURN name;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "item_ledger_append_only" BEFORE UPDATE OR DELETE ON "item_ledger" FOR EACH ROW EXECUTE FUNCTION "identity_append_only"();
