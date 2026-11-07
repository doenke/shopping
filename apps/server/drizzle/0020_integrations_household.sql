DROP INDEX "integrations_owner_type_idx";--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Existing integrations move to their owner's household; if several people of one household had their own,
-- the one used last stays active and the others are kept unattached (nothing is deleted).
UPDATE "integrations" i SET "household_id" = u."household_id" FROM "users" u WHERE u."id" = i."owner_id";--> statement-breakpoint
UPDATE "integrations" i SET "household_id" = NULL WHERE i."id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "household_id", "type" ORDER BY "last_sync_at" DESC NULLS LAST, "id") AS n
    FROM "integrations" WHERE "household_id" IS NOT NULL
  ) ranked WHERE n > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_household_type_idx" ON "integrations" USING btree ("household_id","type");