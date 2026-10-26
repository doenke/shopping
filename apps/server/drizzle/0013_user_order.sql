ALTER TABLE "users" ADD COLUMN "category_order" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "list_order" jsonb DEFAULT '[]'::jsonb NOT NULL;