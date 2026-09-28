DROP TABLE "snapshot_staged_rows";--> statement-breakpoint
DELETE FROM "download_leases" AS "l"
USING "snapshot_jobs" AS "j"
WHERE "j"."organization_id" = "l"."organization_id"
  AND "j"."snapshot_id" = "l"."snapshot_id"
  AND ("j"."stage" <> 'published' OR "j"."horizon" IS NULL);--> statement-breakpoint
DELETE FROM "snapshot_parts" AS "p"
USING "snapshot_jobs" AS "j"
WHERE "j"."organization_id" = "p"."organization_id"
  AND "j"."snapshot_id" = "p"."snapshot_id"
  AND ("j"."stage" <> 'published' OR "j"."horizon" IS NULL);--> statement-breakpoint
DELETE FROM "snapshot_jobs" WHERE "stage" <> 'published' OR "horizon" IS NULL;--> statement-breakpoint
UPDATE "snapshot_jobs" AS "j"
SET "entity_counts_json" = coalesce((
  SELECT jsonb_object_agg("counted"."entity", "counted"."row_count")::text
  FROM (
    SELECT "row" ->> 'entity' AS "entity", count(*) AS "row_count"
    FROM "snapshot_parts" AS "p"
    CROSS JOIN LATERAL jsonb_array_elements(("p"."payload_json")::jsonb -> 'rows') AS "row"
    WHERE "p"."organization_id" = "j"."organization_id"
      AND "p"."snapshot_id" = "j"."snapshot_id"
    GROUP BY 1
  ) AS "counted"
), '{}')
WHERE "j"."entity_counts_json" IS NULL;--> statement-breakpoint
ALTER TABLE "snapshot_jobs" RENAME COLUMN "step_due_at" TO "published_at";--> statement-breakpoint
ALTER TABLE "snapshot_jobs" DROP CONSTRAINT "snapshot_jobs_stage";--> statement-breakpoint
ALTER TABLE "snapshot_jobs" DROP CONSTRAINT "snapshot_jobs_fence_nonnegative";--> statement-breakpoint
DROP INDEX "snapshot_jobs_organization_id_stage_idx";--> statement-breakpoint
DROP INDEX "snapshot_jobs_organization_id_step_due_at_idx";--> statement-breakpoint
ALTER TABLE "snapshot_jobs" DROP COLUMN "stage";--> statement-breakpoint
ALTER TABLE "snapshot_jobs" DROP COLUMN "fence";--> statement-breakpoint
ALTER TABLE "snapshot_jobs" DROP COLUMN "owner_token";--> statement-breakpoint
ALTER TABLE "snapshot_jobs" DROP COLUMN "started_at_commit_sequence";--> statement-breakpoint
ALTER TABLE "snapshot_jobs" DROP COLUMN "copy_entity";--> statement-breakpoint
ALTER TABLE "snapshot_jobs" DROP COLUMN "copy_cursor";--> statement-breakpoint
ALTER TABLE "snapshot_jobs" ALTER COLUMN "horizon" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot_jobs" ALTER COLUMN "entity_counts_json" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "snapshot_jobs_organization_id_horizon_idx" ON "snapshot_jobs" ("organization_id","horizon");--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "sync";--> statement-breakpoint
GRANT USAGE ON SCHEMA "sync" TO PUBLIC;--> statement-breakpoint
CREATE FUNCTION "sync"."now_millis"() RETURNS bigint
LANGUAGE sql VOLATILE PARALLEL SAFE
AS $$
  SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint
$$;--> statement-breakpoint
CREATE FUNCTION "sync"."category_json"("c" "public"."categories") RETURNS json
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT row_to_json("r") FROM (
    SELECT
      "c"."id" AS "id",
      "c"."name" AS "name",
      "c"."tracks_packs" AS "tracksPacks",
      "c"."created_at" AS "createdAt",
      "c"."updated_at" AS "updatedAt",
      "c"."organization_id" AS "organizationId",
      "c"."created_by_user_id" AS "createdByUserId",
      "c"."updated_by_user_id" AS "updatedByUserId",
      "c"."device_id" AS "deviceId",
      "c"."operation_id" AS "operationId",
      "c"."row_version" AS "rowVersion"
  ) AS "r"
$$;--> statement-breakpoint
CREATE FUNCTION "sync"."product_json"("p" "public"."products") RETURNS json
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT row_to_json("r") FROM (
    SELECT
      "p"."id" AS "id",
      "p"."name" AS "name",
      "p"."category_id" AS "categoryId",
      "p"."aisle" AS "aisle",
      "p"."composition" AS "composition",
      "p"."strength" AS "strength",
      "p"."units_per_pack" AS "unitsPerPack",
      "p"."purchase_price" AS "purchasePrice",
      "p"."retail_price" AS "retailPrice",
      "p"."unit_price" AS "unitPrice",
      "p"."visible" AS "visible",
      "p"."created_at" AS "createdAt",
      "p"."updated_at" AS "updatedAt",
      "p"."deleted_at" AS "deletedAt",
      "p"."organization_id" AS "organizationId",
      "p"."created_by_user_id" AS "createdByUserId",
      "p"."updated_by_user_id" AS "updatedByUserId",
      "p"."device_id" AS "deviceId",
      "p"."operation_id" AS "operationId",
      "p"."row_version" AS "rowVersion"
  ) AS "r"
$$;--> statement-breakpoint
CREATE FUNCTION "sync"."batch_json"("b" "public"."batches") RETURNS json
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT row_to_json("r") FROM (
    SELECT
      "b"."id" AS "id",
      "b"."product_id" AS "productId",
      "b"."batch_number" AS "batchNumber",
      "b"."expires_at" AS "expiresAt",
      "b"."pack_quantity" AS "packQuantity",
      "b"."unit_quantity" AS "unitQuantity",
      "b"."created_at" AS "createdAt",
      "b"."updated_at" AS "updatedAt",
      "b"."deleted_at" AS "deletedAt",
      "b"."organization_id" AS "organizationId",
      "b"."created_by_user_id" AS "createdByUserId",
      "b"."updated_by_user_id" AS "updatedByUserId",
      "b"."device_id" AS "deviceId",
      "b"."operation_id" AS "operationId",
      "b"."row_version" AS "rowVersion"
  ) AS "r"
$$;--> statement-breakpoint
CREATE FUNCTION "sync"."category_row"("c" "public"."categories") RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT "sync"."category_json"("c")::jsonb
$$;--> statement-breakpoint
CREATE FUNCTION "sync"."product_row"("p" "public"."products") RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT "sync"."product_json"("p")::jsonb
$$;--> statement-breakpoint
CREATE FUNCTION "sync"."batch_row"("b" "public"."batches") RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT "sync"."batch_json"("b")::jsonb
$$;--> statement-breakpoint
CREATE FUNCTION "sync"."sha256_hex"("value" text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$
  SELECT encode(sha256(convert_to("value", 'UTF8')), 'hex')
$$;--> statement-breakpoint
CREATE FUNCTION "sync"."partition_digest"("org" text) RETURNS jsonb
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  WITH "leaves" AS (
    SELECT 'category' AS "entity", 'category:' || "c"."id" || ':' || "c"."row_version" AS "leaf"
    FROM "public"."categories" AS "c"
    WHERE "c"."organization_id" = "org"
    UNION ALL
    SELECT 'product', 'product:' || "p"."id" || ':' || "p"."row_version"
    FROM "public"."products" AS "p"
    WHERE "p"."organization_id" = "org" AND "p"."deleted_at" IS NULL
    UNION ALL
    SELECT 'batch', 'batch:' || "b"."id" || ':' || "b"."row_version"
    FROM "public"."batches" AS "b"
    WHERE "b"."organization_id" = "org" AND "b"."deleted_at" IS NULL
  ),
  "entities" AS (
    SELECT
      "e"."entity",
      "e"."ordinal",
      count("l"."leaf") AS "leaf_count",
      "sync"."sha256_hex"(
        'store.sync.partition-digest.v2' || E'\n' || "e"."entity" || E'\n' || count("l"."leaf") || E'\n' ||
        coalesce(string_agg("l"."leaf", E'\n' ORDER BY "l"."leaf" COLLATE "C"), '')
      ) AS "digest"
    FROM (VALUES ('category', 1), ('product', 2), ('batch', 3)) AS "e"("entity", "ordinal")
    LEFT JOIN "leaves" AS "l" ON "l"."entity" = "e"."entity"
    GROUP BY "e"."entity", "e"."ordinal"
  )
  SELECT jsonb_build_object(
    'version', 2,
    'digest', "sync"."sha256_hex"(
      'store.sync.partition-digest.v2' || E'\n' || sum("leaf_count") || E'\n' ||
      string_agg("entity" || ':' || "digest", E'\n' ORDER BY "ordinal")
    ),
    'count', sum("leaf_count"),
    'entities', jsonb_object_agg("entity", "digest")
  )
  FROM "entities"
$$;--> statement-breakpoint
CREATE FUNCTION "sync"."build_snapshot"("org" text, "part_rows" integer, "at" bigint) RETURNS text
LANGUAGE sql VOLATILE
AS $$
  WITH "minted" AS (
    SELECT replace(gen_random_uuid()::text, '-', '') AS "snapshot_id"
  ),
  "state" AS (
    SELECT "s"."commit_sequence"
    FROM "public"."inventory_state" AS "s"
    WHERE "s"."organization_id" = "org"
  ),
  "frames" AS (
    SELECT 1 AS "ordinal", 'category' AS "entity", "c"."id" AS "entity_id",
      '{"entity":"category","entityId":' || to_json("c"."id")::text || ',"rowVersion":' || "c"."row_version" ||
      ',"row":' || "sync"."category_json"("c")::text || '}' AS "frame"
    FROM "public"."categories" AS "c"
    WHERE "c"."organization_id" = "org"
    UNION ALL
    SELECT 2, 'product', "p"."id",
      '{"entity":"product","entityId":' || to_json("p"."id")::text || ',"rowVersion":' || "p"."row_version" ||
      ',"row":' || "sync"."product_json"("p")::text || '}'
    FROM "public"."products" AS "p"
    WHERE "p"."organization_id" = "org" AND "p"."deleted_at" IS NULL
    UNION ALL
    SELECT 3, 'batch', "b"."id",
      '{"entity":"batch","entityId":' || to_json("b"."id")::text || ',"rowVersion":' || "b"."row_version" ||
      ',"row":' || "sync"."batch_json"("b")::text || '}'
    FROM "public"."batches" AS "b"
    WHERE "b"."organization_id" = "org" AND "b"."deleted_at" IS NULL
  ),
  "numbered" AS (
    SELECT "f"."frame",
      row_number() OVER (ORDER BY "f"."ordinal", "f"."entity_id" COLLATE "C") AS "position"
    FROM "frames" AS "f"
  ),
  "chunks" AS (
    SELECT (("n"."position" - 1) / "part_rows") + 1 AS "part_number",
      string_agg("n"."frame", ',' ORDER BY "n"."position") AS "rows"
    FROM "numbered" AS "n"
    GROUP BY 1
    UNION ALL
    SELECT 1, '' WHERE NOT EXISTS (SELECT 1 FROM "frames")
  ),
  "job" AS (
    INSERT INTO "public"."snapshot_jobs"
      ("organization_id", "snapshot_id", "subscription", "horizon", "entity_counts_json", "published_at")
    SELECT "org", "m"."snapshot_id", 'operational', "s"."commit_sequence",
      (
        SELECT jsonb_build_object(
          'category', count(*) FILTER (WHERE "f"."entity" = 'category'),
          'product', count(*) FILTER (WHERE "f"."entity" = 'product'),
          'batch', count(*) FILTER (WHERE "f"."entity" = 'batch')
        )::text
        FROM "frames" AS "f"
      ),
      "at"
    FROM "minted" AS "m", "state" AS "s"
    RETURNING "snapshot_id"
  ),
  "payloads" AS (
    SELECT "c"."part_number", "j"."snapshot_id",
      '{"snapshotId":' || to_json("j"."snapshot_id")::text || ',"partNumber":' || "c"."part_number" ||
      ',"rows":[' || "c"."rows" || ']}' AS "payload"
    FROM "chunks" AS "c", "job" AS "j"
  ),
  "parts" AS (
    INSERT INTO "public"."snapshot_parts"
      ("organization_id", "snapshot_id", "part_number", "object_key", "byte_length", "sha256", "payload_json")
    SELECT "org", "p"."snapshot_id", "p"."part_number",
      "org" || '/' || "p"."snapshot_id" || '/' || "p"."part_number",
      octet_length("p"."payload"), "sync"."sha256_hex"("p"."payload"), "p"."payload"
    FROM "payloads" AS "p"
    RETURNING "part_number"
  )
  SELECT "j"."snapshot_id" FROM "job" AS "j"
$$;--> statement-breakpoint
CREATE FUNCTION "sync"."snapshot_manifest"("org" text, "snapshot" text, "epoch" text, "schema_version" integer) RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT jsonb_build_object(
    'snapshotId', "j"."snapshot_id",
    'epoch', "epoch",
    'subscription', "j"."subscription",
    'schemaVersion', "schema_version",
    'horizon', "j"."horizon"::text,
    'parts', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'partNumber', "p"."part_number",
          'objectKey', "p"."object_key",
          'byteLength', "p"."byte_length",
          'sha256', "p"."sha256"
        )
        ORDER BY "p"."part_number"
      )
      FROM "public"."snapshot_parts" AS "p"
      WHERE "p"."organization_id" = "j"."organization_id" AND "p"."snapshot_id" = "j"."snapshot_id"
    ), '[]'::jsonb),
    'entityCounts', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'entity', "e"."entity",
          'rowCount', coalesce(("j"."entity_counts_json"::jsonb ->> "e"."entity")::integer, 0)
        )
        ORDER BY "e"."ordinal"
      )
      FROM (VALUES ('category', 1), ('product', 2), ('batch', 3)) AS "e"("entity", "ordinal")
    )
  )
  FROM "public"."snapshot_jobs" AS "j"
  WHERE "j"."organization_id" = "org" AND "j"."snapshot_id" = "snapshot"
$$;--> statement-breakpoint
CREATE FUNCTION "sync"."snapshot_is_fresh"(
  "head" numeric, "horizon" numeric, "published_at" bigint, "at" bigint,
  "lag_transactions" bigint, "minimum_rebuild_millis" bigint
) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT "horizon" IS NOT NULL
    AND ("head" - "horizon" <= "lag_transactions" OR "at" - "published_at" < "minimum_rebuild_millis")
$$;--> statement-breakpoint
CREATE FUNCTION "sync"."protocol_error"("code" text, "message" text) RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT jsonb_build_object('_tag', 'error', 'code', "code", 'message', "message")
$$;--> statement-breakpoint
CREATE FUNCTION "sync"."newest_snapshot"("org" text) RETURNS "public"."snapshot_jobs"
LANGUAGE sql STABLE
AS $$
  SELECT "j".*
  FROM "public"."snapshot_jobs" AS "j"
  WHERE "j"."organization_id" = "org"
  ORDER BY "j"."horizon" DESC, "j"."snapshot_id" ASC
  LIMIT 1
$$;--> statement-breakpoint
CREATE FUNCTION "sync"."acquire_snapshot"(
  "org" text,
  "replica" text,
  "actor" text,
  "requested_epoch" text,
  "requested_subscription" text,
  "schema_version" integer,
  "part_rows" integer,
  "lease_millis" bigint,
  "lag_transactions" bigint DEFAULT 2000,
  "minimum_rebuild_millis" bigint DEFAULT 900000,
  "now_millis" bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE
SET "lock_timeout" = '3s'
SET "statement_timeout" = '20s'
AS $$
DECLARE
  "at" bigint := coalesce("now_millis", "sync"."now_millis"());
  "state" "public"."inventory_state";
  "owner" text;
  "chosen" "public"."snapshot_jobs";
  "built" text;
BEGIN
  SELECT * INTO "state" FROM "public"."inventory_state" AS "s" WHERE "s"."organization_id" = "org";
  IF NOT FOUND OR "state"."status" <> 'ready' OR "state"."release_id" IS NULL THEN
    RETURN "sync"."protocol_error"('EPOCH_MISMATCH', 'This organization inventory is not ready.');
  END IF;
  IF "state"."epoch" <> "requested_epoch" THEN
    RETURN "sync"."protocol_error"('EPOCH_MISMATCH', 'The replica epoch does not match.');
  END IF;
  IF "requested_subscription" <> 'operational' THEN
    RETURN "sync"."protocol_error"('SCHEMA_VERSION_UNSUPPORTED', 'Only the operational subscription is published.');
  END IF;
  IF "replica" IS NOT NULL THEN
    SELECT "r"."owner_user_id" INTO "owner"
    FROM "public"."replicas" AS "r"
    WHERE "r"."organization_id" = "org" AND "r"."replica_id" = "replica";
    IF "owner" IS NULL THEN
      RETURN "sync"."protocol_error"('REPLICA_UNKNOWN', 'This replica is not registered.');
    END IF;
    IF "owner" <> "actor" THEN
      RETURN "sync"."protocol_error"('REPLICA_OWNED_BY_OTHER', 'This replica belongs to another user.');
    END IF;
  END IF;
  "chosen" := "sync"."newest_snapshot"("org");
  IF NOT coalesce("sync"."snapshot_is_fresh"(
    "state"."commit_sequence", "chosen"."horizon", "chosen"."published_at", "at",
    "lag_transactions", "minimum_rebuild_millis"
  ), false) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('sync.snapshot:' || "org", 0));
    SELECT * INTO "state" FROM "public"."inventory_state" AS "s" WHERE "s"."organization_id" = "org";
    "chosen" := "sync"."newest_snapshot"("org");
    IF NOT coalesce("sync"."snapshot_is_fresh"(
      "state"."commit_sequence", "chosen"."horizon", "chosen"."published_at", "at",
      "lag_transactions", "minimum_rebuild_millis"
    ), false) THEN
      "built" := "sync"."build_snapshot"("org", "part_rows", "at");
      SELECT * INTO "chosen"
      FROM "public"."snapshot_jobs" AS "j"
      WHERE "j"."organization_id" = "org" AND "j"."snapshot_id" = "built";
    END IF;
  END IF;
  IF "replica" IS NOT NULL THEN
    INSERT INTO "public"."download_leases"
      ("organization_id", "replica_id", "snapshot_id", "pinned_horizon", "expires_at")
    VALUES ("org", "replica", "chosen"."snapshot_id", "chosen"."horizon", "at" + "lease_millis")
    ON CONFLICT ("organization_id", "replica_id") DO UPDATE SET
      "snapshot_id" = excluded."snapshot_id",
      "pinned_horizon" = excluded."pinned_horizon",
      "expires_at" = excluded."expires_at";
  END IF;
  RETURN jsonb_build_object(
    '_tag', 'ready',
    'manifest', "sync"."snapshot_manifest"("org", "chosen"."snapshot_id", "state"."epoch", "schema_version")
  );
END
$$;--> statement-breakpoint
CREATE FUNCTION "sync"."maintain"("policy" jsonb DEFAULT '{}'::jsonb, "now_millis" bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE
SET "lock_timeout" = '2s'
SET "statement_timeout" = '30s'
AS $$
DECLARE
  "at" bigint := coalesce("now_millis", "sync"."now_millis"());
  "started" timestamptz := clock_timestamp();
  "budget_millis" integer := coalesce(("policy" ->> 'budgetMillis')::integer, 5000);
  "organization_limit" integer := coalesce(("policy" ->> 'organizationsPerRun')::integer, 100);
  "part_rows" integer := coalesce(("policy" ->> 'partRows')::integer, 500);
  "minimum_retained" numeric := coalesce(("policy" ->> 'minimumRetainedTransactions')::numeric, 10000);
  "delete_batch" integer := coalesce(("policy" ->> 'deleteBatchTransactions')::integer, 500);
  "delete_batches" integer := coalesce(("policy" ->> 'deleteBatchesPerStep')::integer, 4);
  "lease_batch" integer := coalesce(("policy" ->> 'expiredLeaseBatchRows')::integer, 200);
  "ticket_batch" integer := coalesce(("policy" ->> 'expiredTicketBatchRows')::integer, 500);
  "retained_snapshots" integer := coalesce(("policy" ->> 'retainedPublishedSnapshots')::integer, 2);
  "pruned_per_step" integer := coalesce(("policy" ->> 'prunedSnapshotsPerStep')::integer, 5);
  "part_delete_batch" integer := coalesce(("policy" ->> 'snapshotRowDeleteBatchRows')::integer, 500);
  "lag_transactions" bigint := coalesce(("policy" ->> 'lagTransactions')::bigint, 2000);
  "minimum_rebuild" bigint := coalesce(("policy" ->> 'minimumRebuildMillis')::bigint, 900000);
  "tickets" regclass := to_regclass('public.consumed_tickets');
  "org" text;
  "state" "public"."inventory_state";
  "newest" "public"."snapshot_jobs";
  "candidate" record;
  "processed" integer := 0;
  "selected" integer := 0;
  "more" boolean := false;
  "built" boolean;
  "batch" integer;
  "batches" integer;
  "deleted" integer;
  "expired_leases" integer;
  "expired_tickets" integer;
  "pruned" integer;
  "part_budget" integer;
  "parts_deleted" integer;
  "snapshot_horizon" numeric;
  "lease_horizon" numeric;
  "floor_after" numeric;
  "remains" boolean;
  "reports" jsonb := '[]'::jsonb;
  "failures" jsonb := '[]'::jsonb;
  "published" integer := 0;
BEGIN
  FOR "org" IN
    SELECT "s"."organization_id"
    FROM "public"."inventory_state" AS "s"
    WHERE "s"."status" = 'ready'
    ORDER BY "s"."maintained_at" ASC NULLS FIRST, "s"."organization_id" ASC
    LIMIT "organization_limit"
  LOOP
    "selected" := "selected" + 1;
    IF extract(epoch FROM clock_timestamp() - "started") * 1000 >= "budget_millis" THEN
      "more" := true;
      EXIT;
    END IF;
    BEGIN
      SELECT * INTO "state" FROM "public"."inventory_state" AS "s" WHERE "s"."organization_id" = "org";

      WITH "stale" AS (
        SELECT "l"."replica_id"
        FROM "public"."download_leases" AS "l"
        WHERE "l"."organization_id" = "org" AND "l"."expires_at" <= "at"
        ORDER BY "l"."replica_id"
        LIMIT "lease_batch"
      ), "gone" AS (
        DELETE FROM "public"."download_leases" AS "l"
        USING "stale"
        WHERE "l"."organization_id" = "org" AND "l"."replica_id" = "stale"."replica_id"
        RETURNING 1
      )
      SELECT count(*) INTO "expired_leases" FROM "gone";

      "expired_tickets" := 0;
      IF "tickets" IS NOT NULL THEN
        EXECUTE format(
          'WITH "expired" AS (SELECT "nonce_hash" FROM %1$s WHERE "organization_id" = $1 AND "expires_at" <= $2 ORDER BY "expires_at", "nonce_hash" LIMIT $3), '
          '"gone" AS (DELETE FROM %1$s AS "t" USING "expired" WHERE "t"."organization_id" = $1 AND "t"."nonce_hash" = "expired"."nonce_hash" RETURNING 1) '
          'SELECT count(*) FROM "gone"',
          "tickets"
        ) INTO "expired_tickets" USING "org", "at", "ticket_batch";
      END IF;

      "built" := false;
      "newest" := "sync"."newest_snapshot"("org");
      IF NOT coalesce("sync"."snapshot_is_fresh"(
        "state"."commit_sequence", "newest"."horizon", "newest"."published_at", "at",
        "lag_transactions", "minimum_rebuild"
      ), false) AND pg_try_advisory_xact_lock(hashtextextended('sync.snapshot:' || "org", 0)) THEN
        PERFORM "sync"."build_snapshot"("org", "part_rows", "at");
        "built" := true;
      END IF;

      "pruned" := 0;
      "part_budget" := "part_delete_batch";
      FOR "candidate" IN
        SELECT "j"."snapshot_id"
        FROM "public"."snapshot_jobs" AS "j"
        WHERE "j"."organization_id" = "org"
        ORDER BY "j"."horizon" DESC, "j"."snapshot_id" ASC
        OFFSET "retained_snapshots"
        LIMIT "pruned_per_step"
      LOOP
        EXIT WHEN "part_budget" <= 0;
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM "public"."download_leases" AS "l"
          WHERE "l"."organization_id" = "org" AND "l"."snapshot_id" = "candidate"."snapshot_id"
        );
        WITH "doomed" AS (
          SELECT "p"."part_number"
          FROM "public"."snapshot_parts" AS "p"
          WHERE "p"."organization_id" = "org" AND "p"."snapshot_id" = "candidate"."snapshot_id"
          ORDER BY "p"."part_number"
          LIMIT "part_budget"
        ), "gone" AS (
          DELETE FROM "public"."snapshot_parts" AS "p"
          USING "doomed"
          WHERE "p"."organization_id" = "org"
            AND "p"."snapshot_id" = "candidate"."snapshot_id"
            AND "p"."part_number" = "doomed"."part_number"
          RETURNING 1
        )
        SELECT count(*) INTO "parts_deleted" FROM "gone";
        "part_budget" := "part_budget" - "parts_deleted";
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM "public"."snapshot_parts" AS "p"
          WHERE "p"."organization_id" = "org" AND "p"."snapshot_id" = "candidate"."snapshot_id"
        );
        DELETE FROM "public"."snapshot_jobs" AS "j"
        WHERE "j"."organization_id" = "org" AND "j"."snapshot_id" = "candidate"."snapshot_id";
        "pruned" := "pruned" + 1;
      END LOOP;

      SELECT coalesce(max("j"."horizon"), 0) INTO "snapshot_horizon"
      FROM "public"."snapshot_jobs" AS "j"
      WHERE "j"."organization_id" = "org";
      SELECT coalesce(min("l"."pinned_horizon"), "state"."commit_sequence") INTO "lease_horizon"
      FROM "public"."download_leases" AS "l"
      WHERE "l"."organization_id" = "org" AND "l"."expires_at" > "at";
      "floor_after" := greatest(
        least("snapshot_horizon", "lease_horizon", greatest(0, "state"."commit_sequence" - "minimum_retained")),
        "state"."retention_floor"
      );
      UPDATE "public"."inventory_state" AS "s"
      SET "retention_floor" = greatest("s"."retention_floor", "floor_after"),
        "maintained_at" = "at"
      WHERE "s"."organization_id" = "org";
      "deleted" := 0;
      "batches" := 0;
      LOOP
        EXIT WHEN "batches" >= "delete_batches";
        WITH "picked" AS (
          SELECT "t"."commit_sequence"
          FROM "public"."inventory_transactions" AS "t"
          WHERE "t"."organization_id" = "org" AND "t"."commit_sequence" <= "floor_after"
          ORDER BY "t"."commit_sequence"
          LIMIT "delete_batch"
        ), "changes" AS (
          DELETE FROM "public"."inventory_changes" AS "c"
          USING "picked"
          WHERE "c"."organization_id" = "org" AND "c"."commit_sequence" = "picked"."commit_sequence"
        ), "groups" AS (
          DELETE FROM "public"."inventory_transactions" AS "t"
          USING "picked"
          WHERE "t"."organization_id" = "org" AND "t"."commit_sequence" = "picked"."commit_sequence"
          RETURNING 1
        )
        SELECT count(*) INTO "batch" FROM "groups";
        "batches" := "batches" + 1;
        "deleted" := "deleted" + "batch";
        EXIT WHEN "batch" < "delete_batch";
        IF extract(epoch FROM clock_timestamp() - "started") * 1000 >= "budget_millis" THEN
          "more" := true;
          EXIT;
        END IF;
      END LOOP;

      SELECT EXISTS (
        SELECT 1 FROM "public"."inventory_transactions" AS "t"
        WHERE "t"."organization_id" = "org" AND "t"."commit_sequence" <= "floor_after"
      ) INTO "remains";
      IF "remains" THEN
        "more" := true;
      END IF;

      "reports" := "reports" || jsonb_build_object(
        'organizationId', "org",
        'floorBefore', "state"."retention_floor"::text,
        'floorAfter', "floor_after"::text,
        'deletedTransactions', "deleted",
        'expiredLeases', "expired_leases",
        'expiredTickets', "expired_tickets",
        'prunedSnapshots', "pruned",
        'builtSnapshot', "built",
        'more', "remains"
      );
      "processed" := "processed" + 1;
      "published" := "published" + 1;
    EXCEPTION WHEN OTHERS THEN
      "failures" := "failures" || jsonb_build_object('organizationId', "org", 'error', SQLERRM);
    END;
  END LOOP;

  IF "selected" = "organization_limit" THEN
    "more" := true;
  END IF;

  RETURN jsonb_build_object(
    'organizations', "processed",
    'published', "published",
    'retention', "reports",
    'failures', "failures",
    'more', "more",
    'elapsedMillis', round(extract(epoch FROM clock_timestamp() - "started") * 1000)
  );
END
$$;
