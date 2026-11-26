ALTER TABLE "characters" ADD COLUMN "health" integer;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "verve" integer;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "resonance" integer;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "playtime_seconds" integer DEFAULT 0 NOT NULL;