-- The shared household is now created on the first login and named after its first member:
-- drop the empty placeholder from 0011 (installations that already use it keep it and can rename it).
DELETE FROM "households" WHERE "key" = ''
  AND NOT EXISTS (SELECT 1 FROM "users" WHERE "users"."household_id" = "households"."id")
  AND NOT EXISTS (SELECT 1 FROM "lists" WHERE "lists"."household_id" = "households"."id")
  AND NOT EXISTS (SELECT 1 FROM "custom_categories" WHERE "custom_categories"."household_id" = "households"."id");
