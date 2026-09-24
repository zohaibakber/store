ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_organization_category_fk";--> statement-breakpoint
UPDATE "categories" AS "c"
SET "deleted_at" = NULL, "row_version" = "c"."row_version" + 1
WHERE ("c"."organization_id", "c"."id") IN (
  SELECT DISTINCT ON ("d"."organization_id", "d"."name") "d"."organization_id", "d"."id"
  FROM "categories" AS "d"
  WHERE "d"."deleted_at" IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM "products" AS "p"
      WHERE "p"."organization_id" = "d"."organization_id"
        AND "p"."category_id" = "d"."id"
        AND "p"."deleted_at" IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "categories" AS "l"
      WHERE "l"."organization_id" = "d"."organization_id"
        AND "l"."name" = "d"."name"
        AND "l"."deleted_at" IS NULL
    )
  ORDER BY "d"."organization_id", "d"."name", "d"."updated_at" DESC, "d"."id"
);--> statement-breakpoint
UPDATE "products" AS "p"
SET "category_id" = "l"."id", "row_version" = "p"."row_version" + 1
FROM "categories" AS "d", "categories" AS "l"
WHERE "p"."deleted_at" IS NULL
  AND "d"."organization_id" = "p"."organization_id"
  AND "d"."id" = "p"."category_id"
  AND "d"."deleted_at" IS NOT NULL
  AND "l"."organization_id" = "d"."organization_id"
  AND "l"."name" = "d"."name"
  AND "l"."deleted_at" IS NULL;--> statement-breakpoint
DELETE FROM "categories" WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "categories_organization_id_name_uidx";--> statement-breakpoint
ALTER TABLE "categories" DROP COLUMN IF EXISTS "deleted_at";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "categories_organization_id_name_uidx" ON "categories" ("organization_id","name");--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "deleted_at";--> statement-breakpoint
ALTER TABLE "invoice_items" DROP COLUMN IF EXISTS "deleted_at";--> statement-breakpoint
DROP TABLE IF EXISTS "inventory_mutation_receipts";
