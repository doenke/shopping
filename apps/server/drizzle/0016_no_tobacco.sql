-- Tobacco is no longer part of the built-in catalog: the seeded item is hidden (lists keep their entries).
UPDATE "catalog_items" SET "hidden" = true, "seq" = nextval('sync_seq') WHERE "source" = 'seed' AND "name" = 'Zigaretten';
