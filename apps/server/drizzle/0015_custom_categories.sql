CREATE TABLE "custom_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"household_id" uuid,
	"list_type" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"icon_subject" text,
	"icon_name" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hlc" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seq" bigint DEFAULT nextval('sync_seq') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_categories" ADD CONSTRAINT "custom_categories_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_categories" ADD CONSTRAINT "custom_categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_categories_household_idx" ON "custom_categories" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "custom_categories_seq_idx" ON "custom_categories" USING btree ("seq");