CREATE TABLE "account_client_profiles" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"schema_version" integer NOT NULL,
	"revision" integer NOT NULL,
	"profile" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shards" ADD COLUMN "asset_pack" jsonb;--> statement-breakpoint
ALTER TABLE "account_client_profiles" ADD CONSTRAINT "account_client_profiles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;