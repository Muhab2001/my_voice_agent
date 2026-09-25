CREATE TABLE "voice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"openai_call_id" varchar(128),
	"status" varchar(32) DEFAULT 'created' NOT NULL,
	"model" varchar(128),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" varchar(128)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "voice_sessions_openai_call_id_unique" ON "voice_sessions" USING btree ("openai_call_id");--> statement-breakpoint
CREATE INDEX "voice_sessions_status_started_at_idx" ON "voice_sessions" USING btree ("status","started_at");