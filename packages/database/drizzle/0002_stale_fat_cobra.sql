CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_session_id" uuid NOT NULL,
	"content" text NOT NULL,
	"entity" varchar(128),
	"event_at" timestamp with time zone,
	"fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"text" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_sessions" ALTER COLUMN "model" SET DEFAULT 'gpt-live-1';--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN "finalization" varchar(32);--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN "usage" jsonb;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_source_session_id_voice_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."voice_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_snapshots" ADD CONSTRAINT "transcript_snapshots_session_id_voice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."voice_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memories_fingerprint_unique" ON "memories" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "memories_entity_event_idx" ON "memories" USING btree ("entity","event_at");--> statement-breakpoint
CREATE INDEX "transcript_session_time_idx" ON "transcript_snapshots" USING btree ("session_id","start_ms","created_at");
