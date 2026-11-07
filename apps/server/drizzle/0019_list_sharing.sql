ALTER TABLE "lists" ADD COLUMN "sharing" text;--> statement-breakpoint
UPDATE "lists" SET "sharing" = 'link', "seq" = nextval('sync_seq')
WHERE EXISTS (SELECT 1 FROM "list_members" m WHERE m."list_id" = "lists"."id" AND NOT m."removed" AND m."via" = 'link');
