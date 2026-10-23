CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icon_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"candidates" integer DEFAULT 2 NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"hint" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icon_usage" (
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"images" integer DEFAULT 0 NOT NULL,
	"cost_milli" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "icon_usage_day_provider_pk" PRIMARY KEY("day","provider")
);
--> statement-breakpoint
CREATE TABLE "icons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"is_anchor" boolean DEFAULT false NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt" text NOT NULL,
	"seed" integer,
	"reference_set" text,
	"checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"image" "bytea",
	"thumb" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "icon_subject" text;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "icons" ADD CONSTRAINT "icons_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "icon_jobs_open_idx" ON "icon_jobs" USING btree ("target_type","target_id") WHERE status = 'queued';--> statement-breakpoint
CREATE INDEX "icon_jobs_status_idx" ON "icon_jobs" USING btree ("status","priority");--> statement-breakpoint
CREATE INDEX "icons_target_idx" ON "icons" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "icons_status_idx" ON "icons" USING btree ("status");