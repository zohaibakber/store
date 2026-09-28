ALTER TABLE "snapshot_jobs" ADD COLUMN "digest_version" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot_jobs" ADD COLUMN "catalog_parts" integer;--> statement-breakpoint
DROP FUNCTION "sync"."acquire_snapshot"(text, text, text, text, text, integer, integer, bigint, bigint, bigint, bigint);--> statement-breakpoint
DROP FUNCTION "sync"."snapshot_manifest"(text, text, text, integer);--> statement-breakpoint
DROP FUNCTION "sync"."build_snapshot"(text, integer, bigint);--> statement-breakpoint
DROP FUNCTION "sync"."pull"(text, text, text, text, integer, integer, boolean);--> statement-breakpoint
CREATE FUNCTION "sync"."partition_digest"("org" text, "digest_version" integer) RETURNS jsonb
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
    WHERE "digest_version" >= 3 AND "i"."organization_id" = "org"
    UNION ALL
    SELECT 'invoiceItem', 'invoiceItem:' || "t"."id" || ':' || "t"."row_version"
    FROM "public"."invoice_items" AS "t"
    WHERE "digest_version" >= 3 AND "t"."organization_id" = "org"
    UNION ALL
    SELECT 'stockMovement', 'stockMovement:' || "m"."id" || ':1'
    FROM "public"."stock_movements" AS "m"
    WHERE "digest_version" >= 3 AND "m"."organization_id" = "org"
  ),
  "entities" AS (
    SELECT
      "e"."entity",
      "e"."ordinal",
      count("l"."leaf") AS "leaf_count",
      "sync"."sha256_hex"(
        'store.sync.partition-digest.v' || "digest_version" || E'\n' || "e"."entity" || E'\n' ||
        count("l"."leaf") || E'\n' ||
        coalesce(string_agg("l"."leaf", E'\n' ORDER BY "l"."leaf" COLLATE "C"), '')
      ) AS "digest"
    FROM (
      VALUES
        ('category', 1, 2),
        ('product', 2, 2),
        ('batch', 3, 2),
        ('invoice', 4, 3),
        ('invoiceItem', 5, 3),
        ('stockMovement', 6, 3)
    ) AS "e"("entity", "ordinal", "since_version")
    LEFT JOIN "leaves" AS "l" ON "l"."entity" = "e"."entity"
    WHERE "e"."since_version" <= "digest_version"
    GROUP BY "e"."entity", "e"."ordinal"
  )
  SELECT jsonb_build_object(
    'version', "digest_version",
    'digest', "sync"."sha256_hex"(
      'store.sync.partition-digest.v' || "digest_version" || E'\n' || sum("leaf_count") || E'\n' ||
      string_agg("entity" || ':' || "digest", E'\n' ORDER BY "ordinal")
    ),
    'count', sum("leaf_count"),
    'entities', jsonb_object_agg("entity", "digest")
  )
  FROM "entities"
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "sync"."partition_digest"("org" text) RETURNS jsonb
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT "sync"."partition_digest"("org", 2)
$$;--> statement-breakpoint
CREATE FUNCTION "sync"."pull"(
  "p_organization_id" text,
  "p_epoch" text,
  "p_subscription" text,
  "p_after_commit_sequence" text,
  "p_max_groups" integer,
  "p_byte_budget" integer,
  "p_include_digest" boolean,
  "p_digest_version" integer DEFAULT 2,
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
  IF NOT FOUND OR v_state.status <> 'ready' OR v_state.release_id IS NULL THEN
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
    v_digest := sync.partition_digest(p_organization_id, p_digest_version)::text;
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
CREATE FUNCTION "sync"."build_snapshot"("org" text, "part_rows" integer, "at" bigint, "part_bytes" integer DEFAULT 524288) RETURNS text
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
    SELECT 0 AS "segment", 1 AS "ordinal", 'category' AS "entity", "c"."id" AS "entity_id",
      '{"entity":"category","entityId":' || to_json("c"."id")::text || ',"rowVersion":' || "c"."row_version" ||
      ',"row":' || "sync"."category_json"("c")::text || '}' AS "frame"
    FROM "public"."categories" AS "c"
    WHERE "c"."organization_id" = "org"
    UNION ALL
    SELECT 0, 2, 'product', "p"."id",
      '{"entity":"product","entityId":' || to_json("p"."id")::text || ',"rowVersion":' || "p"."row_version" ||
      ',"row":' || "sync"."product_json"("p")::text || '}'
    FROM "public"."products" AS "p"
    WHERE "p"."organization_id" = "org" AND "p"."deleted_at" IS NULL
    UNION ALL
    SELECT 0, 3, 'batch', "b"."id",
      '{"entity":"batch","entityId":' || to_json("b"."id")::text || ',"rowVersion":' || "b"."row_version" ||
      ',"row":' || "sync"."batch_json"("b")::text || '}'
    FROM "public"."batches" AS "b"
    WHERE "b"."organization_id" = "org" AND "b"."deleted_at" IS NULL
    UNION ALL
    SELECT 1, 4, 'invoice', "i"."id",
      '{"entity":"invoice","entityId":' || to_json("i"."id")::text || ',"rowVersion":' || "i"."row_version" ||
      ',"row":' || "sync"."invoice_json"("i")::text || '}'
    FROM "public"."invoices" AS "i"
    WHERE "i"."organization_id" = "org"
    UNION ALL
    SELECT 1, 5, 'invoiceItem', "t"."id",
      '{"entity":"invoiceItem","entityId":' || to_json("t"."id")::text || ',"rowVersion":' || "t"."row_version" ||
      ',"row":' || "sync"."invoice_item_json"("t")::text || '}'
    FROM "public"."invoice_items" AS "t"
    WHERE "t"."organization_id" = "org"
    UNION ALL
    SELECT 1, 6, 'stockMovement', "m"."id",
      '{"entity":"stockMovement","entityId":' || to_json("m"."id")::text || ',"rowVersion":1' ||
      ',"row":' || "sync"."stock_movement_json"("m")::text || '}'
    FROM "public"."stock_movements" AS "m"
    WHERE "m"."organization_id" = "org"
  ),
  "sized" AS (
    SELECT "f"."segment", "f"."frame",
      row_number() OVER "ordered" AS "position",
      coalesce(sum(octet_length("f"."frame") + 1) OVER (
        "ordered" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0) AS "bytes_before"
    FROM "frames" AS "f"
    WINDOW "ordered" AS (PARTITION BY "f"."segment" ORDER BY "f"."ordinal", "f"."entity_id" COLLATE "C")
  ),
  "bucketed" AS (
    SELECT "s"."segment", "s"."frame", "s"."position",
      dense_rank() OVER (
        PARTITION BY "s"."segment"
        ORDER BY "s"."bytes_before" / greatest("part_bytes", 1), ("s"."position" - 1) / greatest("part_rows", 1)
      ) AS "segment_part"
    FROM "sized" AS "s"
  ),
  "catalog" AS (
    SELECT greatest(coalesce(max("b"."segment_part") FILTER (WHERE "b"."segment" = 0), 0), 1) AS "parts"
    FROM "bucketed" AS "b"
  ),
  "chunks" AS (
    SELECT "b"."segment_part" + CASE WHEN "b"."segment" = 0 THEN 0 ELSE "k"."parts" END AS "part_number",
      string_agg("b"."frame", ',' ORDER BY "b"."position") AS "rows"
    FROM "bucketed" AS "b", "catalog" AS "k"
    GROUP BY "b"."segment", "b"."segment_part", "k"."parts"
    UNION ALL
    SELECT 1, '' WHERE NOT EXISTS (SELECT 1 FROM "frames" AS "f" WHERE "f"."segment" = 0)
  ),
  "job" AS (
    INSERT INTO "public"."snapshot_jobs"
      ("organization_id", "snapshot_id", "subscription", "horizon", "entity_counts_json", "published_at",
       "digest_version", "catalog_parts")
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
      "at",
      3,
      "k"."parts"
    FROM "minted" AS "m", "state" AS "s", "catalog" AS "k"
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
CREATE FUNCTION "sync"."snapshot_manifest"(
  "org" text, "snapshot" text, "epoch" text, "schema_version" integer, "digest_version" integer
) RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  WITH "chosen" AS (
    SELECT "j".*, least("snapshot_manifest"."digest_version", "j"."digest_version") AS "served_version"
    FROM "public"."snapshot_jobs" AS "j"
    WHERE "j"."organization_id" = "org" AND "j"."snapshot_id" = "snapshot"
  )
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
        AND ("j"."served_version" >= 3 OR "p"."part_number" <= coalesce("j"."catalog_parts", "p"."part_number"))
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
          ('category', 1, 2),
          ('product', 2, 2),
          ('batch', 3, 2),
          ('invoice', 4, 3),
          ('invoiceItem', 5, 3),
          ('stockMovement', 6, 3)
      ) AS "e"("entity", "ordinal", "since_version")
      WHERE "e"."since_version" <= "j"."served_version"
    )
  ) || CASE WHEN "j"."served_version" >= 3 THEN jsonb_build_object('digestVersion', 3) ELSE '{}'::jsonb END
  FROM "chosen" AS "j"
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "sync"."newest_snapshot"("org" text) RETURNS "public"."snapshot_jobs"
LANGUAGE sql STABLE
AS $$
  SELECT "j".*
  FROM "public"."snapshot_jobs" AS "j"
  WHERE "j"."organization_id" = "org" AND "j"."digest_version" >= 3
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
  "part_bytes" integer DEFAULT 524288,
  "digest_version" integer DEFAULT 2
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
    'manifest', "sync"."snapshot_manifest"(
      "org", "chosen"."snapshot_id", "state"."epoch", "schema_version", "digest_version"
    )
  );
END
$$;
