CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "households_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "list_members" ADD COLUMN "via" text DEFAULT 'link' NOT NULL;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "visibility" text DEFAULT 'household' NOT NULL;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Everyone who exists so far lives in the default household (key ''); the name is set from the configuration at start.
INSERT INTO "households" ("key", "name") VALUES ('', 'Haushalt');--> statement-breakpoint
UPDATE "users" SET "household_id" = (SELECT "id" FROM "households" WHERE "key" = '') WHERE "is_guest" = false;--> statement-breakpoint
UPDATE "lists" SET "household_id" = (SELECT "household_id" FROM "users" WHERE "users"."id" = "lists"."owner_id");--> statement-breakpoint
UPDATE "list_members" SET "via" = 'owner' FROM "lists" WHERE "lists"."id" = "list_members"."list_id" AND "lists"."owner_id" = "list_members"."user_id";--> statement-breakpoint
-- Lists are shared with the whole household from now on.
INSERT INTO "list_members" ("list_id", "user_id", "via")
  SELECT "lists"."id", "users"."id", 'household' FROM "lists" JOIN "users" ON "users"."household_id" = "lists"."household_id"
  WHERE "lists"."deleted" = false
  ON CONFLICT DO NOTHING;
