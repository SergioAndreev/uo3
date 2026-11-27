ALTER TABLE "shards" ALTER COLUMN "protocol_range" SET DEFAULT '>=1.0.0 <2.0.0';--> statement-breakpoint
UPDATE "shards" SET "protocol_range" = '>=1.0.0 <2.0.0' WHERE "protocol_range" = '>=0.1.0 <1.0.0';
