CREATE TABLE "account_shard_entitlements" (
	"account_id" uuid NOT NULL,
	"shard_id" varchar(32) NOT NULL,
	"extra_slots" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "account_shard_entitlements_account_id_shard_id_pk" PRIMARY KEY("account_id","shard_id")
);
--> statement-breakpoint
CREATE TABLE "character_name_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"character_id" uuid NOT NULL,
	"old_name" varchar(32) NOT NULL,
	"new_name" varchar(32) NOT NULL,
	"reason" varchar(32) NOT NULL,
	"changed_by" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_name_holds" (
	"shard_id" varchar(32) NOT NULL,
	"name_key" varchar(32) NOT NULL,
	"account_id" uuid NOT NULL,
	"until" timestamp with time zone NOT NULL,
	CONSTRAINT "character_name_holds_shard_id_name_key_pk" PRIMARY KEY("shard_id","name_key")
);
--> statement-breakpoint
CREATE TABLE "character_skills" (
	"character_id" uuid NOT NULL,
	"skill" varchar(32) NOT NULL,
	"tenths" smallint NOT NULL,
	CONSTRAINT "character_skills_character_id_skill_pk" PRIMARY KEY("character_id","skill")
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shard_id" varchar(32) NOT NULL,
	"account_id" uuid NOT NULL,
	"entity_id" integer NOT NULL,
	"slot" smallint NOT NULL,
	"name" varchar(32) NOT NULL,
	"name_key" varchar(32) NOT NULL,
	"status" varchar(24) NOT NULL,
	"stats" jsonb NOT NULL,
	"appearance" jsonb NOT NULL,
	"background" varchar(32),
	"start_city" varchar(32) NOT NULL,
	"realm" varchar(32) NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"h" smallint NOT NULL,
	"starter_loadout" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_played_at" timestamp with time zone,
	"delete_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"status_before_deletion" varchar(24),
	"renamed_at" timestamp with time zone,
	"lock_reason" text
);
--> statement-breakpoint
CREATE TABLE "shard_entity_sequences" (
	"shard_id" varchar(32) PRIMARY KEY NOT NULL,
	"next_hero" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shards" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"region" varchar(32) NOT NULL,
	"preset" varchar(16) NOT NULL,
	"ruleset_override" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visibility" varchar(16) DEFAULT 'public' NOT NULL,
	"manual_status" varchar(16) DEFAULT 'normal' NOT NULL,
	"maintenance_eta" timestamp with time zone,
	"maintenance_message" text,
	"creation_open" boolean DEFAULT true NOT NULL,
	"character_slots" smallint DEFAULT 5 NOT NULL,
	"rename_policy" varchar(16) DEFAULT 'cooldown' NOT NULL,
	"ticket_ttl_s" smallint DEFAULT 30 NOT NULL,
	"soft_capacity" integer DEFAULT 1000 NOT NULL,
	"hard_capacity" integer DEFAULT 1200 NOT NULL,
	"staff_buffer" integer DEFAULT 20 NOT NULL,
	"protocol_range" varchar(64) DEFAULT '>=0.1.0 <1.0.0' NOT NULL,
	"start_cities" text[] NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account_shard_entitlements" ADD CONSTRAINT "account_shard_entitlements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_shard_entitlements" ADD CONSTRAINT "account_shard_entitlements_shard_id_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."shards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_name_history" ADD CONSTRAINT "character_name_history_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_skills" ADD CONSTRAINT "character_skills_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_shard_id_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."shards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shard_entity_sequences" ADD CONSTRAINT "shard_entity_sequences_shard_id_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."shards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_name_history_idx" ON "character_name_history" USING btree ("character_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "characters_name_live_idx" ON "characters" USING btree ("shard_id","name_key") WHERE "characters"."status" <> 'deleted';--> statement-breakpoint
CREATE UNIQUE INDEX "characters_slot_live_idx" ON "characters" USING btree ("account_id","shard_id","slot") WHERE "characters"."status" <> 'deleted';--> statement-breakpoint
CREATE UNIQUE INDEX "characters_entity_idx" ON "characters" USING btree ("shard_id","entity_id");--> statement-breakpoint
CREATE INDEX "characters_account_idx" ON "characters" USING btree ("account_id","shard_id");--> statement-breakpoint
CREATE INDEX "characters_delete_due_idx" ON "characters" USING btree ("status","delete_at");