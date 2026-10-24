ALTER TABLE "icon_jobs" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "icon_usage" ADD COLUMN "cost_micro" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "icons" ADD COLUMN "ai_review" jsonb;--> statement-breakpoint
ALTER TABLE "icons" ADD COLUMN "svg" text;--> statement-breakpoint
UPDATE "icon_usage" SET "cost_micro" = "cost_milli" * 1000;
