DELETE FROM "download_leases" AS "l"
USING "snapshot_jobs" AS "j"
WHERE "j"."organization_id" = "l"."organization_id"
  AND "j"."snapshot_id" = "l"."snapshot_id"
  AND "j"."digest_version" < 3;--> statement-breakpoint
DELETE FROM "snapshot_parts" AS "p"
USING "snapshot_jobs" AS "j"
WHERE "j"."organization_id" = "p"."organization_id"
  AND "j"."snapshot_id" = "p"."snapshot_id"
  AND "j"."digest_version" < 3;--> statement-breakpoint
DELETE FROM "snapshot_jobs" WHERE "digest_version" < 3;--> statement-breakpoint
DROP FUNCTION "sync"."acquire_snapshot"(text, text, text, text, text, integer, integer, bigint, bigint, bigint, bigint, integer, integer);--> statement-breakpoint
DROP FUNCTION "sync"."snapshot_manifest"(text, text, text, integer, integer);--> statement-breakpoint
DROP FUNCTION "sync"."pull"(text, text, text, text, integer, integer, boolean, integer);--> statement-breakpoint
DROP FUNCTION "sync"."partition_digest"(text);--> statement-breakpoint
DROP FUNCTION "sync"."partition_digest"(text, integer);--> statement-breakpoint
DROP FUNCTION "sync"."category_row"("public"."categories");--> statement-breakpoint
DROP FUNCTION "sync"."product_row"("public"."products");--> statement-breakpoint
DROP FUNCTION "sync"."batch_row"("public"."batches");--> statement-breakpoint
ALTER TABLE "inventory_state" DROP CONSTRAINT "inventory_state_status";--> statement-breakpoint
ALTER TABLE "inventory_state" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "inventory_state" DROP COLUMN "import_id";--> statement-breakpoint
ALTER TABLE "inventory_state" DROP COLUMN "release_id";--> statement-breakpoint
ALTER TABLE "snapshot_jobs" DROP COLUMN "digest_version";--> statement-breakpoint
ALTER TABLE "snapshot_jobs" DROP COLUMN "catalog_parts";--> statement-breakpoint
ALTER TABLE "snapshot_parts" DROP COLUMN "object_key";--> statement-breakpoint
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
    UNION ALL
    SELECT 'invoice', 'invoice:' || "i"."id" || ':' || "i"."row_version"
    FROM "public"."invoices" AS "i"
    WHERE "i"."organization_id" = "org"
    UNION ALL
    SELECT 'invoiceItem', 'invoiceItem:' || "t"."id" || ':' || "t"."row_version"
    FROM "public"."invoice_items" AS "t"
    WHERE "t"."organization_id" = "org"
    UNION ALL
    SELECT 'stockMovement', 'stockMovement:' || "m"."id" || ':1'
    FROM "public"."stock_movements" AS "m"
    WHERE "m"."organization_id" = "org"
  ),
  "entities" AS (
    SELECT
      "e"."entity",
      "e"."ordinal",
      count("l"."leaf") AS "leaf_count",
      "sync"."sha256_hex"(
        'store.sync.partition-digest.v3' || E'\n' || "e"."entity" || E'\n' ||
        count("l"."leaf") || E'\n' ||
        coalesce(string_agg("l"."leaf", E'\n' ORDER BY "l"."leaf" COLLATE "C"), '')
      ) AS "digest"
    FROM (
      VALUES
        ('category', 1),
        ('product', 2),
        ('batch', 3),
        ('invoice', 4),
        ('invoiceItem', 5),
        ('stockMovement', 6)
    ) AS "e"("entity", "ordinal")
    LEFT JOIN "leaves" AS "l" ON "l"."entity" = "e"."entity"
    GROUP BY "e"."entity", "e"."ordinal"
  )
  SELECT jsonb_build_object(
    'version', 3,
    'digest', "sync"."sha256_hex"(
      'store.sync.partition-digest.v3' || E'\n' || sum("leaf_count") || E'\n' ||
      string_agg("entity" || ':' || "digest", E'\n' ORDER BY "ordinal")
    ),
    'count', sum("leaf_count"),
    'entities', jsonb_object_agg("entity", "digest")
  )
  FROM "entities"
$$;--> statement-breakpoint
CREATE FUNCTION "sync"."pull"(
  "p_organization_id" text,
  "p_epoch" text,
  "p_subscription" text,
  "p_after_commit_sequence" text,
  "p_max_groups" integer,
  "p_byte_budget" integer,
  "p_include_digest" boolean,
  OUT "body" text,
  OUT "error_code" text,
  OUT "error_message" text
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_state public.inventory_state;
  v_after numeric := p_after_commit_sequence::numeric;
  v_transactions text;
  v_last numeric;
  v_next text;
  v_digest text;
BEGIN
  SELECT * INTO v_state FROM public.inventory_state AS s WHERE s.organization_id = p_organization_id;
  IF NOT FOUND THEN
    error_code := 'EPOCH_MISMATCH';
    error_message := 'This organization inventory is not ready.';
    RETURN;
  END IF;
  IF v_state.epoch <> p_epoch THEN
    error_code := 'EPOCH_MISMATCH';
    error_message := 'The replica epoch does not match.';
    RETURN;
  END IF;
  IF v_after > v_state.commit_sequence THEN
    error_code := 'SNAPSHOT_REQUIRED';
    error_message := 'This replica is ahead of the authority and needs recovery.';
    RETURN;
  END IF;
  IF v_after < v_state.retention_floor THEN
    error_code := 'SNAPSHOT_REQUIRED';
    error_message := 'This replica is behind the retained history and needs a snapshot.';
    RETURN;
  END IF;
  WITH candidates AS (
    SELECT t.commit_sequence, t.operation_id, t.decision, t.byte_length
    FROM public.inventory_transactions AS t
    WHERE t.organization_id = p_organization_id
      AND t.epoch = p_epoch
      AND t.commit_sequence > v_after
    ORDER BY t.commit_sequence
    LIMIT p_max_groups
  ),
  sized AS (
    SELECT c.commit_sequence, c.operation_id, c.decision,
      sum(c.byte_length) OVER (ORDER BY c.commit_sequence) AS used,
      row_number() OVER (ORDER BY c.commit_sequence) AS position
    FROM candidates AS c
  )
  SELECT
    string_agg(
      sync.group_frame(
        g.commit_sequence,
        g.operation_id,
        g.decision,
        coalesce((
          SELECT string_agg(
            sync.change_frame(ROW(ch.entity, ch.action, ch.entity_id, ch.row_version, ch.row_json)::sync.change_row),
            ',' ORDER BY ch.ordinal
          )
          FROM public.inventory_changes AS ch
          WHERE ch.organization_id = p_organization_id
            AND ch.commit_sequence = g.commit_sequence
        ), '')
      ),
      ',' ORDER BY g.commit_sequence
    ),
    max(g.commit_sequence)
  INTO v_transactions, v_last
  FROM sized AS g
  WHERE g.position = 1 OR g.used <= p_byte_budget;
  v_next := coalesce(v_last::text, p_after_commit_sequence);
  IF p_include_digest AND coalesce(v_last, v_after) >= v_state.commit_sequence THEN
    v_digest := sync.partition_digest(p_organization_id)::text;
  END IF;
  body := sync.page_frame(
    v_state.epoch,
    v_state.incarnation,
    p_subscription,
    coalesce(v_transactions, ''),
    v_next,
    v_state.commit_sequence,
    v_state.retention_floor,
    v_digest
  );
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "sync"."build_snapshot"("org" text, "part_rows" integer, "at" bigint, "part_bytes" integer DEFAULT 524288) RETURNS text
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
    UNION ALL
    SELECT 4, 'invoice', "i"."id",
      '{"entity":"invoice","entityId":' || to_json("i"."id")::text || ',"rowVersion":' || "i"."row_version" ||
      ',"row":' || "sync"."invoice_json"("i")::text || '}'
    FROM "public"."invoices" AS "i"
    WHERE "i"."organization_id" = "org"
    UNION ALL
    SELECT 5, 'invoiceItem', "t"."id",
      '{"entity":"invoiceItem","entityId":' || to_json("t"."id")::text || ',"rowVersion":' || "t"."row_version" ||
      ',"row":' || "sync"."invoice_item_json"("t")::text || '}'
    FROM "public"."invoice_items" AS "t"
    WHERE "t"."organization_id" = "org"
    UNION ALL
    SELECT 6, 'stockMovement', "m"."id",
      '{"entity":"stockMovement","entityId":' || to_json("m"."id")::text || ',"rowVersion":1' ||
      ',"row":' || "sync"."stock_movement_json"("m")::text || '}'
    FROM "public"."stock_movements" AS "m"
    WHERE "m"."organization_id" = "org"
  ),
  "sized" AS (
    SELECT "f"."frame",
      row_number() OVER "ordered" AS "position",
      coalesce(sum(octet_length("f"."frame") + 1) OVER (
        "ordered" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0) AS "bytes_before"
    FROM "frames" AS "f"
    WINDOW "ordered" AS (ORDER BY "f"."ordinal", "f"."entity_id" COLLATE "C")
  ),
  "chunks" AS (
    SELECT "b"."part_number", string_agg("b"."frame", ',' ORDER BY "b"."position") AS "rows"
    FROM (
      SELECT "s"."frame", "s"."position",
        dense_rank() OVER (
          ORDER BY "s"."bytes_before" / greatest("part_bytes", 1), ("s"."position" - 1) / greatest("part_rows", 1)
        ) AS "part_number"
      FROM "sized" AS "s"
    ) AS "b"
    GROUP BY "b"."part_number"
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
          'batch', count(*) FILTER (WHERE "f"."entity" = 'batch'),
          'invoice', count(*) FILTER (WHERE "f"."entity" = 'invoice'),
          'invoiceItem', count(*) FILTER (WHERE "f"."entity" = 'invoiceItem'),
          'stockMovement', count(*) FILTER (WHERE "f"."entity" = 'stockMovement')
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
      ("organization_id", "snapshot_id", "part_number", "byte_length", "sha256", "payload_json")
    SELECT "org", "p"."snapshot_id", "p"."part_number",
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
          'objectKey', "p"."organization_id" || '/' || "p"."snapshot_id" || '/' || "p"."part_number",
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
      FROM (
      VALUES
        ('category', 1),
        ('product', 2),
        ('batch', 3),
        ('invoice', 4),
        ('invoiceItem', 5),
        ('stockMovement', 6)
      ) AS "e"("entity", "ordinal")
    ),
    'digestVersion', 3
  )
  FROM "public"."snapshot_jobs" AS "j"
  WHERE "j"."organization_id" = "org" AND "j"."snapshot_id" = "snapshot"
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "sync"."newest_snapshot"("org" text) RETURNS "public"."snapshot_jobs"
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
  "now_millis" bigint DEFAULT NULL,
  "part_bytes" integer DEFAULT 524288
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
  IF NOT FOUND THEN
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
      "built" := "sync"."build_snapshot"("org", "part_rows", "at", "part_bytes");
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
CREATE OR REPLACE FUNCTION "sync"."maintain"("policy" jsonb DEFAULT '{}'::jsonb, "now_millis" bigint DEFAULT NULL) RETURNS jsonb
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
  "retained_snapshots" integer := coalesce(("policy" ->> 'retainedPublishedSnapshots')::integer, 2);
  "pruned_per_step" integer := coalesce(("policy" ->> 'prunedSnapshotsPerStep')::integer, 5);
  "part_delete_batch" integer := coalesce(("policy" ->> 'snapshotRowDeleteBatchRows')::integer, 500);
  "lag_transactions" bigint := coalesce(("policy" ->> 'lagTransactions')::bigint, 2000);
  "minimum_rebuild" bigint := coalesce(("policy" ->> 'minimumRebuildMillis')::bigint, 900000);
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
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync.submit_request_problem(p_request jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  v_command jsonb := p_request->'command';
  v_payload jsonb := p_request->'command'->'payload';
  v_problem text;
  v_write jsonb;
BEGIN
  IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN RETURN 'request'; END IF;
  IF NOT sync.is_js_string(p_request->'organizationId', 1, NULL) THEN RETURN 'organizationId'; END IF;
  IF NOT sync.is_decimal_sequence(p_request->'epoch') THEN RETURN 'epoch'; END IF;
  IF NOT sync.is_js_string(p_request->'replicaId', 1, 200) THEN RETURN 'replicaId'; END IF;
  IF NOT sync.is_decimal_sequence(p_request->'clientSequence') THEN RETURN 'clientSequence'; END IF;
  IF NOT sync.is_js_string(p_request->'operationId', 1, 200) THEN RETURN 'operationId'; END IF;
  IF coalesce(jsonb_typeof(p_request->'payloadHash') <> 'string' OR NOT (p_request->>'payloadHash') ~ '^[0-9a-f]{64}$', true) THEN
    RETURN 'payloadHash';
  END IF;
  IF NOT sync.is_decimal_sequence(p_request->'afterCommitSequence') THEN
    RETURN 'afterCommitSequence';
  END IF;
  IF p_request ? 'maxBytes' AND NOT sync.is_js_int(p_request->'maxBytes', 1) THEN RETURN 'maxBytes'; END IF;
  IF jsonb_typeof(v_command) IS DISTINCT FROM 'object' THEN RETURN 'command'; END IF;
  IF NOT sync.is_one_of(v_command->'_tag', ARRAY['issueInvoice', 'catalogWrite']) THEN RETURN 'command._tag'; END IF;
  IF jsonb_typeof(v_payload) IS DISTINCT FROM 'object' THEN RETURN 'command.payload'; END IF;
  IF NOT sync.is_js_string(v_payload->'commandId', 1, 200) THEN RETURN 'command.payload.commandId'; END IF;
  IF NOT sync.is_js_string(v_payload->'deviceId', 1, 200) THEN RETURN 'command.payload.deviceId'; END IF;
  IF NOT sync.is_js_int(v_payload->'occurredAt', 1) THEN RETURN 'command.payload.occurredAt'; END IF;
  IF v_command->>'_tag' = 'issueInvoice' THEN
    RETURN 'command.payload.' || sync.invoice_command_problem(v_payload);
  END IF;
  IF jsonb_typeof(v_payload->'writes') IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_payload->'writes') NOT BETWEEN 1 AND 1000
  THEN
    RETURN 'command.payload.writes';
  END IF;
  FOR v_write IN SELECT e.value FROM jsonb_array_elements(v_payload->'writes') AS e(value) LOOP
    v_problem := sync.catalog_write_problem(v_write);
    IF v_problem IS NOT NULL THEN
      RETURN 'command.payload.writes[].' || v_problem;
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync.submit_command(
  p_actor jsonb,
  p_request json,
  p_received_at bigint,
  p_page_bytes integer,
  OUT body text,
  OUT fanout_epoch text,
  OUT fanout_horizon text,
  OUT fanout_group text,
  OUT fanout_bytes integer,
  OUT error_code text,
  OUT error_message text
)
LANGUAGE plpgsql AS $$
DECLARE
  v_envelope jsonb := p_request::jsonb;
  v_organization_id text := p_actor->>'organizationId';
  v_user_id text := p_actor->>'userId';
  v_operation_id text := v_envelope->>'operationId';
  v_replica_id text := v_envelope->>'replicaId';
  v_after text := v_envelope->>'afterCommitSequence';
  v_command jsonb := v_envelope->'command';
  v_state public.inventory_state;
  v_receipt public.command_receipts;
  v_replica public.replicas;
  v_expected_sequence text;
  v_decision text;
  v_result text;
  v_changes sync.change_row[];
  v_code text;
  v_problem text;
  v_message text;
  v_commit numeric;
  v_group text;
  v_bytes integer;
  v_page record;
  v_page_body text;
BEGIN
  v_problem := sync.submit_request_problem(v_envelope);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'invalid_parameter_value',
      MESSAGE = 'The command envelope is malformed at ' || v_problem || '.';
  END IF;
  IF v_envelope->>'organizationId' IS DISTINCT FROM v_organization_id THEN
    error_code := 'ORGANIZATION_MISMATCH';
    error_message := 'The command does not belong to the active organization.';
    RETURN;
  END IF;
  IF sync.sha256_hex(sync.canonical_json(p_request->'command')) IS DISTINCT FROM v_envelope->>'payloadHash' THEN
    error_code := 'INVALID_PAYLOAD_HASH';
    error_message := 'The payload hash does not match.';
    RETURN;
  END IF;
  SELECT * INTO v_state FROM public.inventory_state AS s
  WHERE s.organization_id = v_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    error_code := 'EPOCH_MISMATCH';
    error_message := 'This organization inventory is not ready.';
    RETURN;
  END IF;
  IF v_state.epoch IS DISTINCT FROM v_envelope->>'epoch' THEN
    error_code := 'EPOCH_MISMATCH';
    error_message := 'The replica epoch does not match.';
    RETURN;
  END IF;

  SELECT * INTO v_receipt FROM public.command_receipts AS r
  WHERE r.organization_id = v_organization_id AND r.operation_id = v_operation_id;
  IF FOUND THEN
    IF v_receipt.payload_hash IS DISTINCT FROM v_envelope->>'payloadHash' THEN
      error_code := 'OPERATION_ID_REUSED';
      error_message := 'The command id was reused.';
      RETURN;
    END IF;
    body := sync.receipt_frame(v_receipt);
    SELECT * INTO v_page FROM sync.pull(
      v_organization_id, v_envelope->>'epoch', 'operational', v_after, 100, p_page_bytes, false
    );
    IF v_page.error_code IS NULL THEN
      body := left(body, -1) || ',"page":' || v_page.body || '}';
    END IF;
    RETURN;
  END IF;

  SELECT * INTO v_replica FROM public.replicas AS r
  WHERE r.organization_id = v_organization_id AND r.replica_id = v_replica_id;
  IF NOT FOUND THEN
    error_code := 'REPLICA_UNKNOWN';
    error_message := 'This replica is not registered.';
    RETURN;
  END IF;
  IF v_replica.owner_user_id IS DISTINCT FROM v_user_id THEN
    error_code := 'REPLICA_OWNED_BY_OTHER';
    error_message := 'This replica belongs to another user.';
    RETURN;
  END IF;
  v_expected_sequence := (v_replica.last_client_sequence + 1)::text;
  IF v_envelope->>'clientSequence' IS DISTINCT FROM v_expected_sequence THEN
    error_code := 'REPLICA_SEQUENCE_GAP';
    error_message := 'Expected client sequence ' || v_expected_sequence || ', received '
      || (v_envelope->>'clientSequence') || '.';
    RETURN;
  END IF;

  IF v_command->'payload'->>'commandId' IS NOT DISTINCT FROM v_operation_id THEN
    BEGIN
      IF v_command->>'_tag' = 'issueInvoice' THEN
        SELECT e.out_result, e.out_changes INTO v_result, v_changes
        FROM sync.issue_invoice(v_organization_id, v_user_id, v_command->'payload') AS e;
      ELSE
        SELECT e.out_result, e.out_changes INTO v_result, v_changes
        FROM sync.catalog_write(v_organization_id, v_user_id, v_command->'payload') AS e;
      END IF;
      v_decision := 'accepted';
    EXCEPTION
      WHEN SQLSTATE 'ZS001' THEN
        GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      WHEN unique_violation THEN
        v_code := 'ENTITY_CONFLICT';
        v_message := 'A record this command creates already exists.';
      WHEN numeric_value_out_of_range OR invalid_text_representation OR check_violation THEN
        v_code := 'INVALID_OPERATION';
        v_message := 'A value in this command is out of range.';
    END;
    IF v_code IS NOT NULL THEN
      v_decision := 'rejected';
      v_changes := ARRAY[]::sync.change_row[];
      v_result := '{"_tag":"rejected","code":' || to_json(v_code)::text
        || ',"message":' || to_json(v_message)::text || '}';
    END IF;
  ELSE
    v_decision := 'rejected';
    v_changes := ARRAY[]::sync.change_row[];
    v_result := '{"_tag":"rejected","code":"COMMAND_IDENTITY_MISMATCH","message":"The command id must match the envelope operation id."}';
  END IF;

  v_commit := v_state.commit_sequence + 1;
  SELECT 128 + octet_length(v_operation_id) + coalesce(sum(
      96 + octet_length(c.row_json) + octet_length(c.entity_id) + octet_length(c.entity)
    ), 0),
    coalesce(string_agg(
      sync.change_frame(ROW(c.entity, c.action, c.entity_id, c.row_version, c.row_json)::sync.change_row),
      ',' ORDER BY c.position
    ), '')
  INTO v_bytes, v_group
  FROM unnest(v_changes) WITH ORDINALITY AS c(entity, action, entity_id, row_version, row_json, position);
  v_group := sync.group_frame(v_commit, v_operation_id, v_decision, v_group);

  UPDATE public.inventory_state AS s SET commit_sequence = v_commit
  WHERE s.organization_id = v_organization_id;
  INSERT INTO public.inventory_transactions (
    organization_id, commit_sequence, operation_id, decision, epoch, byte_length
  ) VALUES (v_organization_id, v_commit, v_operation_id, v_decision, v_state.epoch, v_bytes);
  INSERT INTO public.inventory_changes (
    organization_id, commit_sequence, ordinal, entity, action, entity_id, row_version, row_json
  )
  SELECT v_organization_id, v_commit, c.position - 1, c.entity, c.action, c.entity_id, c.row_version, c.row_json
  FROM unnest(v_changes) WITH ORDINALITY AS c(entity, action, entity_id, row_version, row_json, position);
  INSERT INTO public.command_receipts (
    organization_id, operation_id, replica_id, client_sequence, payload_hash, decision,
    commit_sequence, result_json, received_at, attempts
  ) VALUES (
    v_organization_id, v_operation_id, v_replica_id, (v_envelope->>'clientSequence')::numeric,
    v_envelope->>'payloadHash', v_decision, v_commit, v_result, p_received_at, 1
  )
  RETURNING * INTO v_receipt;
  UPDATE public.replicas AS r
  SET last_client_sequence = (v_envelope->>'clientSequence')::numeric, last_seen_at = p_received_at
  WHERE r.organization_id = v_organization_id AND r.replica_id = v_replica_id;

  body := sync.receipt_frame(v_receipt);
  fanout_epoch := v_state.epoch;
  fanout_horizon := v_commit::text;
  fanout_group := v_group;
  fanout_bytes := v_bytes;

  IF v_after::numeric = v_state.commit_sequence THEN
    IF v_bytes <= p_page_bytes THEN
      v_page_body := sync.page_frame(
        v_state.epoch, v_state.incarnation, 'operational', v_group, v_commit::text,
        v_commit, v_state.retention_floor, NULL
      );
    END IF;
  ELSE
    SELECT * INTO v_page FROM sync.pull(
      v_organization_id, v_state.epoch, 'operational', v_after, 100, p_page_bytes, false
    );
    IF v_page.error_code IS NULL THEN
      v_page_body := v_page.body;
    END IF;
  END IF;
  IF v_page_body IS NOT NULL THEN
    body := left(body, -1) || ',"page":' || v_page_body || '}';
  END IF;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync.register_replica(
  p_actor jsonb,
  p_request jsonb,
  p_now bigint,
  p_incarnation text,
  OUT body text,
  OUT error_code text,
  OUT error_message text
)
LANGUAGE plpgsql AS $$
DECLARE
  v_organization_id text := p_actor->>'organizationId';
  v_user_id text := p_actor->>'userId';
  v_replica_id text := p_request->>'replicaId';
  v_state public.inventory_state;
  v_replica public.replicas;
  v_next text;
BEGIN
  INSERT INTO public.inventory_state (
    organization_id, incarnation, epoch, commit_sequence, retention_floor
  ) VALUES (v_organization_id, p_incarnation, '1', 0, 0)
  ON CONFLICT (organization_id) DO NOTHING;
  SELECT * INTO v_state FROM public.inventory_state AS s
  WHERE s.organization_id = v_organization_id
  FOR UPDATE;
  SELECT * INTO v_replica FROM public.replicas AS r
  WHERE r.organization_id = v_organization_id AND r.replica_id = v_replica_id;
  IF FOUND THEN
    IF v_replica.owner_user_id IS DISTINCT FROM v_user_id THEN
      error_code := 'REPLICA_OWNED_BY_OTHER';
      error_message := 'This replica belongs to another user.';
      RETURN;
    END IF;
    UPDATE public.replicas AS r
    SET last_seen_at = p_now,
      device_label = CASE WHEN p_request ? 'deviceLabel' THEN p_request->>'deviceLabel' ELSE r.device_label END
    WHERE r.organization_id = v_organization_id AND r.replica_id = v_replica_id;
    v_next := (v_replica.last_client_sequence + 1)::text;
  ELSE
    INSERT INTO public.replicas (
      organization_id, replica_id, owner_user_id, device_label, last_client_sequence,
      processed_through_client_sequence, registered_at, last_seen_at
    ) VALUES (
      v_organization_id, v_replica_id, v_user_id, p_request->>'deviceLabel', 0, 0, p_now, p_now
    );
    v_next := '1';
  END IF;
  body := '{"replicaId":' || to_json(v_replica_id)::text
    || ',"nextClientSequence":"' || v_next
    || '","epoch":' || to_json(v_state.epoch)::text
    || ',"incarnation":' || to_json(v_state.incarnation)::text
    || ',"retentionFloor":"' || v_state.retention_floor::text
    || '","horizon":"' || v_state.commit_sequence::text
    || '","schemaVersion":1}';
END
$$;
