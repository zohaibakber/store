ALTER TABLE "inventory_transactions" ADD COLUMN "byte_length" integer;--> statement-breakpoint
UPDATE "inventory_transactions" AS "t"
SET "byte_length" = 128 + octet_length("t"."operation_id") + coalesce((
  SELECT sum(96 + octet_length("c"."row_json") + octet_length("c"."entity_id") + octet_length("c"."entity"))
  FROM "inventory_changes" AS "c"
  WHERE "c"."organization_id" = "t"."organization_id"
    AND "c"."commit_sequence" = "t"."commit_sequence"
), 0);--> statement-breakpoint
ALTER TABLE "inventory_transactions" ALTER COLUMN "byte_length" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_byte_length_positive" CHECK ("byte_length" > 0);--> statement-breakpoint
ALTER TABLE "snapshot_jobs" ADD COLUMN "entity_counts_json" text;--> statement-breakpoint
UPDATE "snapshot_jobs" AS "j"
SET "entity_counts_json" = coalesce((
  SELECT json_object_agg("counted"."entity", "counted"."row_count")::text
  FROM (
    SELECT "row" ->> 'entity' AS "entity", count(*) AS "row_count"
    FROM "snapshot_parts" AS "p"
    CROSS JOIN LATERAL jsonb_array_elements(("p"."payload_json")::jsonb -> 'rows') AS "row"
    WHERE "p"."organization_id" = "j"."organization_id"
      AND "p"."snapshot_id" = "j"."snapshot_id"
    GROUP BY 1
  ) AS "counted"
), '{}')
WHERE "j"."stage" = 'published';
