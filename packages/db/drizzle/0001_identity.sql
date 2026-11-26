CREATE TABLE "access_audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"target_id" uuid,
	"action" varchar(64) NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip" varchar(64) NOT NULL,
	"user_agent" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_bans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"issued_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"lifted_at" timestamp with time zone,
	"lifted_by" uuid,
	"lift_reason" text
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" text,
	"status" varchar(32) NOT NULL,
	"access_level" varchar(32) DEFAULT 'player' NOT NULL,
	"effective_level" varchar(32) DEFAULT 'player' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL,
	"family_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" varchar(64),
	"mfa" boolean NOT NULL,
	"reauth_at" timestamp with time zone,
	"ip" varchar(64) NOT NULL,
	"user_agent" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"purpose" varchar(16) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"new_email" varchar(254),
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" varchar(16) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(16) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_identities" (
	"provider" varchar(16) NOT NULL,
	"provider_user_id" varchar(128) NOT NULL,
	"account_id" uuid NOT NULL,
	"email" varchar(254),
	"linked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "oauth_identities_provider_provider_user_id_pk" PRIMARY KEY("provider","provider_user_id")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"type" varchar(48) NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"reason_code" varchar(64),
	"ip" varchar(64) NOT NULL,
	"user_agent" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tos_acceptances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"tos_version" varchar(64) NOT NULL,
	"privacy_version" varchar(64) NOT NULL,
	"ip" varchar(64) NOT NULL,
	"user_agent" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "totp_enrollments" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(16) NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" varchar(32) NOT NULL,
	"tag" varchar(32) NOT NULL,
	"key_version" varchar(32) NOT NULL,
	"last_used_step" bigint,
	"setup_token_hash" varchar(64),
	"setup_expires_at" timestamp with time zone,
	"enabled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account_bans" ADD CONSTRAINT "account_bans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_codes" ADD CONSTRAINT "backup_codes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_identities" ADD CONSTRAINT "oauth_identities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_auth_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tos_acceptances" ADD CONSTRAINT "tos_acceptances_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totp_enrollments" ADD CONSTRAINT "totp_enrollments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_audit_log_at_idx" ON "access_audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "account_bans_account_idx" ON "account_bans" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_email_live_idx" ON "accounts" USING btree ("email") WHERE "accounts"."status" <> 'expired';--> statement-breakpoint
CREATE INDEX "accounts_access_level_idx" ON "accounts" USING btree ("access_level");--> statement-breakpoint
CREATE INDEX "auth_sessions_account_idx" ON "auth_sessions" USING btree ("account_id","revoked_at");--> statement-breakpoint
CREATE INDEX "backup_codes_account_idx" ON "backup_codes" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_tokens_hash_idx" ON "email_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_tokens_account_idx" ON "email_tokens" USING btree ("account_id","purpose");--> statement-breakpoint
CREATE INDEX "identity_outbox_due_idx" ON "identity_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_identities_account_provider_idx" ON "oauth_identities" USING btree ("account_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_idx" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "security_events_account_idx" ON "security_events" USING btree ("account_id","at");--> statement-breakpoint
CREATE FUNCTION "identity_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF current_setting('duskmarch.retention', true) = 'on' AND TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'таблица % только для добавления', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "security_events_append_only" BEFORE UPDATE OR DELETE ON "security_events" FOR EACH ROW EXECUTE FUNCTION "identity_append_only"();
--> statement-breakpoint
CREATE TRIGGER "access_audit_log_append_only" BEFORE UPDATE OR DELETE ON "access_audit_log" FOR EACH ROW EXECUTE FUNCTION "identity_append_only"();
--> statement-breakpoint
CREATE TRIGGER "tos_acceptances_append_only" BEFORE UPDATE OR DELETE ON "tos_acceptances" FOR EACH ROW EXECUTE FUNCTION "identity_append_only"();
