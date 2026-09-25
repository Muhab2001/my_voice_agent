ALTER TABLE "voice_sessions" RENAME COLUMN "openai_call_id" TO "vendor_session_id";--> statement-breakpoint
DROP INDEX "voice_sessions_openai_call_id_unique";--> statement-breakpoint
ALTER TABLE "voice_sessions" ALTER COLUMN "model" SET DEFAULT 'gpt-realtime-2.1';--> statement-breakpoint
UPDATE "voice_sessions" SET "model" = 'gpt-realtime-2.1' WHERE "model" IS NULL;--> statement-breakpoint
ALTER TABLE "voice_sessions" ALTER COLUMN "model" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN "vendor" varchar(32) DEFAULT 'openai' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "voice_sessions_vendor_session_unique" ON "voice_sessions" USING btree ("vendor","vendor_session_id");
