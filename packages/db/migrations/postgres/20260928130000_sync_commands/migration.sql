CREATE SCHEMA IF NOT EXISTS sync;
--> statement-breakpoint
CREATE TYPE sync.change_row AS (
  entity text,
  action text,
  entity_id text,
  row_version integer,
  row_json text
);
--> statement-breakpoint
CREATE FUNCTION sync.invoice_json("i" public.invoices) RETURNS json
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT row_to_json("r") FROM (
    SELECT
      "i"."id" AS "id",
      "i"."invoice_number" AS "invoiceNumber",
      "i"."customer_name" AS "customerName",
      "i"."total" AS "total",
      "i"."created_at" AS "createdAt",
      "i"."updated_at" AS "updatedAt",
      "i"."organization_id" AS "organizationId",
      "i"."created_by_user_id" AS "createdByUserId",
      "i"."updated_by_user_id" AS "updatedByUserId",
      "i"."device_id" AS "deviceId",
      "i"."operation_id" AS "operationId",
      "i"."row_version" AS "rowVersion"
  ) AS "r"
$$;
--> statement-breakpoint
CREATE FUNCTION sync.invoice_item_json("i" public.invoice_items) RETURNS json
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT row_to_json("r") FROM (
    SELECT
      "i"."id" AS "id",
      "i"."invoice_id" AS "invoiceId",
      "i"."product_id" AS "productId",
      "i"."batch_id" AS "batchId",
      "i"."product_name" AS "productName",
      "i"."batch_number" AS "batchNumber",
      "i"."quantity" AS "quantity",
      "i"."quantity_type" AS "quantityType",
      "i"."base_unit_quantity" AS "baseUnitQuantity",
      "i"."sale_price" AS "salePrice",
      "i"."created_at" AS "createdAt",
      "i"."updated_at" AS "updatedAt",
      "i"."organization_id" AS "organizationId",
      "i"."created_by_user_id" AS "createdByUserId",
      "i"."updated_by_user_id" AS "updatedByUserId",
      "i"."device_id" AS "deviceId",
      "i"."operation_id" AS "operationId",
      "i"."row_version" AS "rowVersion"
  ) AS "r"
$$;
--> statement-breakpoint
CREATE FUNCTION sync.stock_movement_json("m" public.stock_movements) RETURNS json
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT row_to_json("r") FROM (
    SELECT
      "m"."id" AS "id",
      "m"."product_id" AS "productId",
      "m"."batch_id" AS "batchId",
      "m"."invoice_id" AS "invoiceId",
      "m"."type" AS "type",
      "m"."pack_delta" AS "packDelta",
      "m"."unit_delta" AS "unitDelta",
      "m"."note" AS "note",
      "m"."organization_id" AS "organizationId",
      "m"."actor_user_id" AS "actorUserId",
      "m"."device_id" AS "deviceId",
      "m"."operation_id" AS "operationId",
      "m"."created_at" AS "createdAt"
  ) AS "r"
$$;
--> statement-breakpoint
CREATE FUNCTION sync.change_frame(c sync.change_row) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT '{"entity":' || to_json(c.entity)::text
    || ',"action":' || to_json(c.action)::text
    || ',"entityId":' || to_json(c.entity_id)::text
    || ',"rowVersion":' || c.row_version::text
    || ',"row":' || c.row_json || '}'
$$;
--> statement-breakpoint
CREATE FUNCTION sync.group_frame(
  commit_sequence numeric,
  operation_id text,
  decision text,
  changes text
) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT '{"commitSequence":"' || commit_sequence::text
    || '","operationId":' || to_json(operation_id)::text
    || ',"decision":' || to_json(decision)::text
    || ',"changes":[' || changes || ']}'
$$;
--> statement-breakpoint
CREATE FUNCTION sync.page_frame(
  epoch text,
  incarnation text,
  subscription text,
  transactions text,
  next_commit_sequence text,
  horizon numeric,
  retention_floor numeric,
  digest text
) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT '{"epoch":' || to_json(epoch)::text
    || ',"incarnation":' || to_json(incarnation)::text
    || ',"subscription":' || to_json(subscription)::text
    || ',"schemaVersion":1,"transactions":[' || transactions
    || '],"nextCommitSequence":' || to_json(next_commit_sequence)::text
    || ',"horizon":"' || horizon::text
    || '","retentionFloor":"' || retention_floor::text || '"'
    || coalesce(',"digest":' || digest, '') || '}'
$$;
--> statement-breakpoint
CREATE FUNCTION sync.receipt_frame(r public.command_receipts) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT '{"operationId":' || to_json(r.operation_id)::text
    || ',"replicaId":' || to_json(r.replica_id)::text
    || ',"clientSequence":"' || r.client_sequence::text
    || '","payloadHash":' || to_json(r.payload_hash)::text
    || ',"decision":' || to_json(r.decision)::text
    || ',"commitSequence":"' || r.commit_sequence::text
    || '","result":' || r.result_json || '}'
$$;
--> statement-breakpoint
CREATE FUNCTION sync.js_trim(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(value, E'\u0009\u000a\u000b\u000c\u000d                  　﻿')
$$;
--> statement-breakpoint
CREATE FUNCTION sync.canonical_json(value json) RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
  CASE json_typeof(value)
    WHEN 'object' THEN
      RETURN '{' || coalesce((
        SELECT string_agg(to_json(e.key)::text || ':' || sync.canonical_json(e.value), ',' ORDER BY e.key COLLATE "C")
        FROM json_each(value) AS e
      ), '') || '}';
    WHEN 'array' THEN
      RETURN '[' || coalesce((
        SELECT string_agg(sync.canonical_json(e.value), ',' ORDER BY e.position)
        FROM json_array_elements(value) WITH ORDINALITY AS e(value, position)
      ), '') || ']';
    WHEN 'string' THEN
      RETURN to_json(value #>> '{}')::text;
    ELSE
      RETURN value::text;
  END CASE;
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.reject(p_code text, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'ZS001', MESSAGE = p_message, DETAIL = p_code;
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.pull(
  p_organization_id text,
  p_epoch text,
  p_subscription text,
  p_after_commit_sequence text,
  p_max_groups integer,
  p_byte_budget integer,
  p_include_digest boolean,
  OUT body text,
  OUT error_code text,
  OUT error_message text
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
$$;
--> statement-breakpoint
CREATE FUNCTION sync.allocations_cover_input(items jsonb, allocations jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_line jsonb;
  v_take jsonb;
  v_remaining numeric;
  v_index integer := 0;
  v_count integer := jsonb_array_length(allocations);
BEGIN
  FOR v_line IN
    SELECT e.value FROM jsonb_array_elements(items) WITH ORDINALITY AS e(value, position) ORDER BY e.position
  LOOP
    v_remaining := (v_line->>'quantity')::numeric;
    WHILE v_remaining > 0 LOOP
      IF v_index >= v_count THEN
        RETURN false;
      END IF;
      v_take := allocations->v_index;
      IF v_take->>'productId' IS DISTINCT FROM v_line->>'productId'
        OR v_take->>'quantityType' IS DISTINCT FROM v_line->>'quantityType'
        OR (v_take->>'salePrice')::numeric IS DISTINCT FROM (v_line->>'salePrice')::numeric
        OR (jsonb_typeof(v_line->'batchId') <> 'null' AND v_take->>'batchId' IS DISTINCT FROM v_line->>'batchId')
        OR (v_take->>'quantity')::numeric > v_remaining
      THEN
        RETURN false;
      END IF;
      v_remaining := v_remaining - (v_take->>'quantity')::numeric;
      v_index := v_index + 1;
    END LOOP;
  END LOOP;
  RETURN v_index = v_count;
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.issue_invoice(
  p_organization_id text,
  p_user_id text,
  p_command jsonb,
  OUT out_result text,
  OUT out_changes sync.change_row[]
)
LANGUAGE plpgsql AS $$
DECLARE
  v_items jsonb := p_command->'input'->'items';
  v_allocations jsonb := p_command->'allocations';
  v_command_id text := p_command->>'commandId';
  v_device_id text := p_command->>'deviceId';
  v_occurred_at bigint := (p_command->>'occurredAt')::bigint;
  v_invoice_id text := p_command->>'invoiceId';
  v_customer_name text := nullif(sync.js_trim(p_command->'input'->>'customerName'), '');
  v_existing_operation text;
  v_take jsonb;
  v_plan jsonb;
  v_plans jsonb := '[]'::jsonb;
  v_working jsonb := '{}'::jsonb;
  v_product public.products;
  v_current public.batches;
  v_image public.batches;
  v_has_batch boolean;
  v_quantity bigint;
  v_available bigint;
  v_opened bigint;
  v_next_pack bigint;
  v_next_unit bigint;
  v_total_exact numeric;
  v_total integer;
  v_invoice public.invoices;
  v_item public.invoice_items;
  v_movement public.stock_movements;
  v_updated integer;
BEGIN
  out_changes := ARRAY[]::sync.change_row[];
  IF jsonb_array_length(v_items) = 0 THEN
    PERFORM sync.reject('INVALID_OPERATION', 'Add at least one item to the sale.');
  END IF;
  IF NOT sync.allocations_cover_input(v_items, v_allocations) THEN
    PERFORM sync.reject('INVALID_OPERATION', 'The sale allocations do not match the items.');
  END IF;

  SELECT i.operation_id INTO v_existing_operation
  FROM public.invoices AS i
  WHERE i.organization_id = p_organization_id AND i.id = v_invoice_id;
  IF FOUND AND v_existing_operation IS DISTINCT FROM v_command_id THEN
    PERFORM sync.reject('INVOICE_IDENTITY_CONFLICT', 'This invoice id is already in use.');
  END IF;

  FOR v_take IN
    SELECT e.value FROM jsonb_array_elements(v_allocations) WITH ORDINALITY AS e(value, position) ORDER BY e.position
  LOOP
    SELECT * INTO v_product
    FROM public.products AS p
    WHERE p.organization_id = p_organization_id AND p.id = v_take->>'productId';
    IF NOT FOUND OR v_product.deleted_at IS NOT NULL THEN
      PERFORM sync.reject('INSUFFICIENT_STOCK', 'One of the products no longer exists.');
    END IF;
    IF v_working ? (v_take->>'batchId') THEN
      v_current := jsonb_populate_record(NULL::public.batches, v_working->(v_take->>'batchId'));
      v_has_batch := true;
    ELSE
      SELECT * INTO v_current
      FROM public.batches AS b
      WHERE b.organization_id = p_organization_id
        AND b.id = v_take->>'batchId'
        AND b.product_id = v_product.id;
      v_has_batch := FOUND;
    END IF;
    IF NOT v_has_batch OR v_current.deleted_at IS NOT NULL THEN
      PERFORM sync.reject('INSUFFICIENT_STOCK', 'The selected batch for ' || v_product.name || ' is gone.');
    END IF;
    v_quantity := (v_take->>'quantity')::bigint;
    v_available := CASE
      WHEN v_take->>'quantityType' = 'pack' THEN v_current.pack_quantity::bigint
      ELSE v_current.pack_quantity::bigint * v_product.units_per_pack + v_current.unit_quantity
    END;
    IF v_available < v_quantity THEN
      PERFORM sync.reject(
        'INSUFFICIENT_STOCK',
        'Not enough stock for ' || v_product.name || ': ' || v_available || ' available, ' || v_quantity || ' requested.'
      );
    END IF;
    v_opened := CASE
      WHEN v_take->>'quantityType' = 'unit'
        THEN greatest(0, ceil((v_quantity - v_current.unit_quantity)::numeric / v_product.units_per_pack))::bigint
      ELSE 0
    END;
    IF v_take->>'quantityType' = 'pack' THEN
      v_next_pack := v_current.pack_quantity - v_quantity;
      v_next_unit := v_current.unit_quantity;
    ELSE
      v_next_pack := v_current.pack_quantity - v_opened;
      v_next_unit := v_current.unit_quantity + v_opened * v_product.units_per_pack - v_quantity;
    END IF;
    IF v_next_pack < 0 OR v_next_unit < 0 THEN
      PERFORM sync.reject('INSUFFICIENT_STOCK', 'Not enough stock for ' || v_product.name || '.');
    END IF;
    v_plans := v_plans || jsonb_build_array(jsonb_build_object(
      'take', v_take,
      'product', to_jsonb(v_product),
      'batch', to_jsonb(v_current),
      'nextPack', v_next_pack,
      'nextUnit', v_next_unit,
      'opened', v_opened
    ));
    v_current.pack_quantity := v_next_pack;
    v_current.unit_quantity := v_next_unit;
    v_working := jsonb_set(v_working, ARRAY[v_take->>'batchId'], to_jsonb(v_current));
  END LOOP;

  SELECT coalesce(sum((l.value->>'quantity')::numeric * (l.value->>'salePrice')::numeric), 0)
  INTO v_total_exact
  FROM jsonb_array_elements(v_items) AS l(value);
  v_total := CASE
    WHEN v_total_exact = trunc(v_total_exact) THEN trunc(v_total_exact)::integer
    ELSE v_total_exact::text::integer
  END;

  INSERT INTO public.invoices AS i (
    id, invoice_number, customer_name, total, organization_id, created_by_user_id,
    updated_by_user_id, device_id, operation_id, row_version, created_at, updated_at
  ) VALUES (
    v_invoice_id, (p_command->>'invoiceNumber')::integer, v_customer_name, v_total, p_organization_id,
    p_user_id, p_user_id, v_device_id, v_command_id, 1, v_occurred_at, v_occurred_at
  )
  ON CONFLICT (organization_id, invoice_number) DO NOTHING
  RETURNING * INTO v_invoice;
  IF NOT FOUND THEN
    INSERT INTO public.invoices AS i (
      id, invoice_number, customer_name, total, organization_id, created_by_user_id,
      updated_by_user_id, device_id, operation_id, row_version, created_at, updated_at
    ) VALUES (
      v_invoice_id,
      (SELECT coalesce(max(x.invoice_number), 0) + 1 FROM public.invoices AS x WHERE x.organization_id = p_organization_id),
      v_customer_name, v_total, p_organization_id,
      p_user_id, p_user_id, v_device_id, v_command_id, 1, v_occurred_at, v_occurred_at
    )
    ON CONFLICT (organization_id, invoice_number) DO NOTHING
    RETURNING * INTO v_invoice;
    IF NOT FOUND THEN
      PERFORM sync.reject('ENTITY_WRITE_FAILED', 'The invoice could not be created.');
    END IF;
  END IF;
  out_changes := out_changes
    || ROW('invoice', 'upsert', v_invoice.id, v_invoice.row_version, sync.invoice_json(v_invoice)::text)::sync.change_row;

  UPDATE public.batches AS b
  SET pack_quantity = w.pack_quantity,
    unit_quantity = w.unit_quantity,
    row_version = w.row_version + 1,
    updated_by_user_id = p_user_id,
    device_id = v_device_id,
    operation_id = v_command_id,
    updated_at = v_occurred_at
  FROM jsonb_each(v_working) AS e(key, value)
  CROSS JOIN LATERAL jsonb_populate_record(NULL::public.batches, e.value) AS w
  WHERE b.organization_id = p_organization_id AND b.id = e.key;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> (SELECT count(*) FROM jsonb_object_keys(v_working)) THEN
    PERFORM sync.reject('ENTITY_WRITE_FAILED', 'The batch could not be updated.');
  END IF;

  FOR v_plan IN
    SELECT e.value FROM jsonb_array_elements(v_plans) WITH ORDINALITY AS e(value, position) ORDER BY e.position
  LOOP
    v_take := v_plan->'take';
    v_product := jsonb_populate_record(NULL::public.products, v_plan->'product');
    v_image := jsonb_populate_record(NULL::public.batches, v_plan->'batch');
    v_image.pack_quantity := (v_plan->>'nextPack')::integer;
    v_image.unit_quantity := (v_plan->>'nextUnit')::integer;
    v_image.updated_by_user_id := p_user_id;
    v_image.device_id := v_device_id;
    v_image.operation_id := v_command_id;
    v_image.updated_at := v_occurred_at;
    v_image.row_version := v_image.row_version + 1;
    v_opened := (v_plan->>'opened')::bigint;
    v_quantity := (v_take->>'quantity')::bigint;

    INSERT INTO public.invoice_items (
      id, invoice_id, product_id, batch_id, product_name, batch_number, quantity, quantity_type,
      base_unit_quantity, sale_price, organization_id, created_by_user_id, updated_by_user_id,
      device_id, operation_id, row_version, created_at, updated_at
    ) VALUES (
      v_take->>'invoiceItemId', v_invoice.id, v_product.id, v_image.id, v_product.name, v_image.batch_number,
      v_quantity, v_take->>'quantityType',
      v_quantity * CASE WHEN v_take->>'quantityType' = 'pack' THEN v_product.units_per_pack ELSE 1 END,
      (v_take->>'salePrice')::integer, p_organization_id, p_user_id, p_user_id,
      v_device_id, v_command_id, 1, v_occurred_at, v_occurred_at
    )
    RETURNING * INTO v_item;

    out_changes := out_changes
      || ROW('batch', 'upsert', v_image.id, v_image.row_version, sync.batch_json(v_image)::text)::sync.change_row
      || ROW('invoiceItem', 'upsert', v_item.id, v_item.row_version, sync.invoice_item_json(v_item)::text)::sync.change_row;

    IF v_opened > 0 THEN
      INSERT INTO public.stock_movements (
        id, product_id, batch_id, invoice_id, type, pack_delta, unit_delta, note, organization_id,
        actor_user_id, device_id, operation_id, created_at
      ) VALUES (
        coalesce(v_take->>'openPackMovementId', (v_take->>'saleMovementId') || ':open-pack'),
        v_product.id, v_image.id, v_invoice.id, 'open_pack', -v_opened, v_opened * v_product.units_per_pack,
        'Opened for invoice #' || v_invoice.invoice_number, p_organization_id,
        p_user_id, v_device_id, v_command_id, v_occurred_at
      )
      RETURNING * INTO v_movement;
      out_changes := out_changes
        || ROW('stockMovement', 'upsert', v_movement.id, 1, sync.stock_movement_json(v_movement)::text)::sync.change_row;
    END IF;

    INSERT INTO public.stock_movements (
      id, product_id, batch_id, invoice_id, type, pack_delta, unit_delta, note, organization_id,
      actor_user_id, device_id, operation_id, created_at
    ) VALUES (
      v_take->>'saleMovementId', v_product.id, v_image.id, v_invoice.id, 'sale',
      CASE WHEN v_take->>'quantityType' = 'pack' THEN -v_quantity ELSE 0 END,
      CASE WHEN v_take->>'quantityType' = 'unit' THEN -v_quantity ELSE 0 END,
      'Invoice #' || v_invoice.invoice_number, p_organization_id,
      p_user_id, v_device_id, v_command_id, v_occurred_at
    )
    RETURNING * INTO v_movement;
    out_changes := out_changes
      || ROW('stockMovement', 'upsert', v_movement.id, 1, sync.stock_movement_json(v_movement)::text)::sync.change_row;
  END LOOP;

  out_result := '{"_tag":"issueInvoice","invoiceId":' || to_json(v_invoice_id)::text
    || ',"invoiceNumber":' || v_invoice.invoice_number::text || '}';
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.catalog_movement(
  p_organization_id text,
  p_user_id text,
  p_device_id text,
  p_command_id text,
  p_occurred_at bigint,
  p_write jsonb,
  p_type text,
  p_pack_delta bigint,
  p_unit_delta bigint
) RETURNS sync.change_row
LANGUAGE plpgsql AS $$
DECLARE
  v_movement public.stock_movements;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.stock_movements AS m
    WHERE m.organization_id = p_organization_id AND m.id = p_write->>'movementId'
  ) THEN
    PERFORM sync.reject('ENTITY_CONFLICT', 'Movement ' || (p_write->>'movementId') || ' is already recorded.');
  END IF;
  INSERT INTO public.stock_movements (
    id, product_id, batch_id, invoice_id, type, pack_delta, unit_delta, note, organization_id,
    actor_user_id, device_id, operation_id, created_at
  ) VALUES (
    p_write->>'movementId', p_write->'row'->>'productId', p_write->>'id', NULL, p_type,
    p_pack_delta, p_unit_delta, p_write->>'note', p_organization_id,
    p_user_id, p_device_id, p_command_id, p_occurred_at
  )
  RETURNING * INTO v_movement;
  RETURN ROW('stockMovement', 'upsert', v_movement.id, 1, sync.stock_movement_json(v_movement)::text)::sync.change_row;
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.catalog_write(
  p_organization_id text,
  p_user_id text,
  p_command jsonb,
  OUT out_result text,
  OUT out_changes sync.change_row[]
)
LANGUAGE plpgsql AS $$
DECLARE
  v_command_id text := p_command->>'commandId';
  v_device_id text := p_command->>'deviceId';
  v_occurred_at bigint := (p_command->>'occurredAt')::bigint;
  v_write jsonb;
  v_row jsonb;
  v_id text;
  v_expected bigint;
  v_found boolean;
  v_category public.categories;
  v_product public.products;
  v_batch public.batches;
  v_previous public.batches;
BEGIN
  out_changes := ARRAY[]::sync.change_row[];
  FOR v_write IN
    SELECT e.value FROM jsonb_array_elements(p_command->'writes') WITH ORDINALITY AS e(value, position) ORDER BY e.position
  LOOP
    v_id := v_write->>'id';
    v_row := v_write->'row';
    v_expected := (v_write->>'expectedRowVersion')::bigint;

    IF v_write->>'entity' = 'category' THEN
      SELECT * INTO v_category FROM public.categories AS c
      WHERE c.organization_id = p_organization_id AND c.id = v_id;
      v_found := FOUND;
      IF v_write->>'action' = 'delete' THEN
        IF NOT v_found THEN
          PERFORM sync.reject('ENTITY_CONFLICT', 'Category ' || v_id || ' is no longer available.');
        END IF;
        IF v_expected IS DISTINCT FROM v_category.row_version THEN
          PERFORM sync.reject('ENTITY_CONFLICT', 'Category ' || v_id || ' changed since it was read.');
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.products AS p
          WHERE p.organization_id = p_organization_id AND p.category_id = v_id AND p.deleted_at IS NULL
        ) THEN
          PERFORM sync.reject('ENTITY_CONFLICT', 'Move products to another category before deleting this category.');
        END IF;
        DELETE FROM public.categories AS c
        WHERE c.organization_id = p_organization_id AND c.id = v_id
        RETURNING * INTO v_category;
        out_changes := out_changes
          || ROW('category', 'delete', v_category.id, v_category.row_version + 1, sync.category_json(v_category)::text)::sync.change_row;
      ELSE
        IF v_expected IS NULL AND v_found THEN
          PERFORM sync.reject('ENTITY_CONFLICT', 'Category ' || v_id || ' already exists.');
        END IF;
        IF v_expected IS NOT NULL AND NOT v_found THEN
          PERFORM sync.reject('ENTITY_CONFLICT', 'Category ' || v_id || ' is no longer available.');
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.categories AS c
          WHERE c.organization_id = p_organization_id AND c.name = v_row->>'name' AND c.id <> v_id
        ) THEN
          PERFORM sync.reject('ENTITY_CONFLICT', 'Category name ' || (v_row->>'name') || ' is already in use.');
        END IF;
        IF v_expected IS NULL THEN
          INSERT INTO public.categories (
            id, name, tracks_packs, organization_id, created_by_user_id, updated_by_user_id,
            device_id, operation_id, row_version, created_at, updated_at
          ) VALUES (
            v_id, v_row->>'name', (v_row->>'tracksPacks')::boolean, p_organization_id, p_user_id, p_user_id,
            v_device_id, v_command_id, 1, v_occurred_at, v_occurred_at
          )
          RETURNING * INTO v_category;
        ELSE
          UPDATE public.categories AS c
          SET name = v_row->>'name',
            tracks_packs = (v_row->>'tracksPacks')::boolean,
            updated_by_user_id = p_user_id,
            device_id = v_device_id,
            operation_id = v_command_id,
            row_version = v_category.row_version + 1,
            updated_at = v_occurred_at
          WHERE c.organization_id = p_organization_id AND c.id = v_id
          RETURNING * INTO v_category;
        END IF;
        out_changes := out_changes
          || ROW('category', 'upsert', v_category.id, v_category.row_version, sync.category_json(v_category)::text)::sync.change_row;
      END IF;

    ELSIF v_write->>'entity' = 'product' THEN
      SELECT * INTO v_product FROM public.products AS p
      WHERE p.organization_id = p_organization_id AND p.id = v_id;
      v_found := FOUND;
      IF v_write->>'action' = 'delete' THEN
        IF NOT v_found OR v_product.deleted_at IS NOT NULL THEN
          PERFORM sync.reject('ENTITY_CONFLICT', 'Product ' || v_id || ' is no longer available.');
        END IF;
        IF v_expected IS DISTINCT FROM v_product.row_version THEN
          PERFORM sync.reject('ENTITY_CONFLICT', 'Product ' || v_id || ' changed since it was read.');
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.batches AS b
          WHERE b.organization_id = p_organization_id AND b.product_id = v_id AND b.deleted_at IS NULL
            AND (b.pack_quantity > 0 OR b.unit_quantity > 0)
        ) THEN
          PERFORM sync.reject('ENTITY_CONFLICT', 'Clear remaining stock before deleting this product.');
        END IF;
        UPDATE public.products AS p
        SET deleted_at = v_occurred_at,
          updated_by_user_id = p_user_id,
          device_id = v_device_id,
          operation_id = v_command_id,
          row_version = v_product.row_version + 1,
          updated_at = v_occurred_at
        WHERE p.organization_id = p_organization_id AND p.id = v_id
        RETURNING * INTO v_product;
        out_changes := out_changes
          || ROW('product', 'delete', v_product.id, v_product.row_version, sync.product_json(v_product)::text)::sync.change_row;
      ELSE
        IF v_expected IS NULL THEN
          IF v_found THEN
            PERFORM sync.reject('ENTITY_CONFLICT', 'Product ' || v_id || ' already exists.');
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM public.categories AS c
            WHERE c.organization_id = p_organization_id AND c.id = v_row->>'categoryId'
          ) THEN
            PERFORM sync.reject('ENTITY_RELATION_INVALID', 'Category ' || (v_row->>'categoryId') || ' is not available in this organization.');
          END IF;
          INSERT INTO public.products (
            id, name, category_id, aisle, composition, strength, units_per_pack, purchase_price,
            retail_price, unit_price, visible, organization_id, created_by_user_id, updated_by_user_id,
            device_id, operation_id, row_version, created_at, updated_at
          ) VALUES (
            v_id, v_row->>'name', v_row->>'categoryId', v_row->>'aisle', v_row->>'composition', v_row->>'strength',
            (v_row->>'unitsPerPack')::integer, (v_row->>'purchasePrice')::integer,
            (v_row->>'retailPrice')::integer, (v_row->>'unitPrice')::integer, (v_row->>'visible')::boolean,
            p_organization_id, p_user_id, p_user_id, v_device_id, v_command_id, 1, v_occurred_at, v_occurred_at
          )
          RETURNING * INTO v_product;
        ELSE
          IF NOT v_found OR v_product.deleted_at IS NOT NULL THEN
            PERFORM sync.reject('ENTITY_CONFLICT', 'Product ' || v_id || ' is no longer available.');
          END IF;
          IF (v_row->>'unitsPerPack')::numeric IS DISTINCT FROM v_product.units_per_pack THEN
            IF v_expected IS DISTINCT FROM v_product.row_version THEN
              PERFORM sync.reject('ENTITY_CONFLICT', 'Product ' || v_id || ' changed since units per pack was read.');
            END IF;
            IF EXISTS (
              SELECT 1 FROM public.batches AS b
              WHERE b.organization_id = p_organization_id AND b.product_id = v_id AND b.deleted_at IS NULL
                AND (b.pack_quantity > 0 OR b.unit_quantity > 0)
            ) THEN
              PERFORM sync.reject('ENTITY_CONFLICT', 'Change units per pack only after the product has no remaining stock.');
            END IF;
          END IF;
          IF v_row->>'categoryId' IS DISTINCT FROM v_product.category_id AND NOT EXISTS (
            SELECT 1 FROM public.categories AS c
            WHERE c.organization_id = p_organization_id AND c.id = v_row->>'categoryId'
          ) THEN
            PERFORM sync.reject('ENTITY_RELATION_INVALID', 'Category ' || (v_row->>'categoryId') || ' is not available in this organization.');
          END IF;
          UPDATE public.products AS p
          SET name = v_row->>'name',
            category_id = v_row->>'categoryId',
            aisle = v_row->>'aisle',
            composition = v_row->>'composition',
            strength = v_row->>'strength',
            units_per_pack = (v_row->>'unitsPerPack')::integer,
            purchase_price = (v_row->>'purchasePrice')::integer,
            retail_price = (v_row->>'retailPrice')::integer,
            unit_price = (v_row->>'unitPrice')::integer,
            visible = (v_row->>'visible')::boolean,
            updated_by_user_id = p_user_id,
            device_id = v_device_id,
            operation_id = v_command_id,
            row_version = v_product.row_version + 1,
            updated_at = v_occurred_at
          WHERE p.organization_id = p_organization_id AND p.id = v_id
          RETURNING * INTO v_product;
        END IF;
        out_changes := out_changes
          || ROW('product', 'upsert', v_product.id, v_product.row_version, sync.product_json(v_product)::text)::sync.change_row;
      END IF;

    ELSE
      SELECT * INTO v_batch FROM public.batches AS b
      WHERE b.organization_id = p_organization_id AND b.id = v_id;
      v_found := FOUND;
      IF v_write->>'action' = 'delete' THEN
        IF NOT v_found OR v_batch.deleted_at IS NOT NULL THEN
          PERFORM sync.reject('ENTITY_CONFLICT', 'Batch ' || v_id || ' is no longer available.');
        END IF;
        IF v_expected IS DISTINCT FROM v_batch.row_version THEN
          PERFORM sync.reject('ENTITY_CONFLICT', 'Batch ' || v_id || ' changed since it was read.');
        END IF;
        IF v_batch.pack_quantity > 0 OR v_batch.unit_quantity > 0 THEN
          PERFORM sync.reject('ENTITY_CONFLICT', 'Clear remaining stock before deleting this batch.');
        END IF;
        UPDATE public.batches AS b
        SET deleted_at = v_occurred_at,
          updated_by_user_id = p_user_id,
          device_id = v_device_id,
          operation_id = v_command_id,
          row_version = v_batch.row_version + 1,
          updated_at = v_occurred_at
        WHERE b.organization_id = p_organization_id AND b.id = v_id
        RETURNING * INTO v_batch;
        out_changes := out_changes
          || ROW('batch', 'delete', v_batch.id, v_batch.row_version, sync.batch_json(v_batch)::text)::sync.change_row;
      ELSE
        IF NOT EXISTS (
          SELECT 1 FROM public.products AS p
          WHERE p.organization_id = p_organization_id AND p.id = v_row->>'productId' AND p.deleted_at IS NULL
        ) THEN
          PERFORM sync.reject('ENTITY_RELATION_INVALID', 'Product ' || (v_row->>'productId') || ' is not available in this organization.');
        END IF;
        IF v_expected IS NULL THEN
          IF v_found THEN
            PERFORM sync.reject('ENTITY_CONFLICT', 'Batch ' || v_id || ' already exists.');
          END IF;
          INSERT INTO public.batches (
            id, product_id, batch_number, expires_at, pack_quantity, unit_quantity, organization_id,
            created_by_user_id, updated_by_user_id, device_id, operation_id, row_version, created_at, updated_at
          ) VALUES (
            v_id, v_row->>'productId', v_row->>'batchNumber', (v_row->>'expiresAt')::bigint,
            (v_row->>'packQuantity')::integer, (v_row->>'unitQuantity')::integer, p_organization_id,
            p_user_id, p_user_id, v_device_id, v_command_id, 1, v_occurred_at, v_occurred_at
          )
          RETURNING * INTO v_batch;
          out_changes := out_changes
            || ROW('batch', 'upsert', v_batch.id, v_batch.row_version, sync.batch_json(v_batch)::text)::sync.change_row;
          IF v_batch.pack_quantity > 0 OR v_batch.unit_quantity > 0 THEN
            out_changes := out_changes || sync.catalog_movement(
              p_organization_id, p_user_id, v_device_id, v_command_id, v_occurred_at, v_write,
              'stock_in', v_batch.pack_quantity, v_batch.unit_quantity
            );
          END IF;
        ELSE
          IF NOT v_found OR v_batch.deleted_at IS NOT NULL THEN
            PERFORM sync.reject('ENTITY_CONFLICT', 'Batch ' || v_id || ' is no longer available.');
          END IF;
          IF v_expected IS DISTINCT FROM v_batch.row_version THEN
            PERFORM sync.reject('ENTITY_CONFLICT', 'Batch ' || v_id || ' changed since it was read.');
          END IF;
          v_previous := v_batch;
          UPDATE public.batches AS b
          SET product_id = v_row->>'productId',
            batch_number = v_row->>'batchNumber',
            expires_at = (v_row->>'expiresAt')::bigint,
            pack_quantity = (v_row->>'packQuantity')::integer,
            unit_quantity = (v_row->>'unitQuantity')::integer,
            updated_by_user_id = p_user_id,
            device_id = v_device_id,
            operation_id = v_command_id,
            row_version = v_batch.row_version + 1,
            updated_at = v_occurred_at
          WHERE b.organization_id = p_organization_id AND b.id = v_id
          RETURNING * INTO v_batch;
          out_changes := out_changes
            || ROW('batch', 'upsert', v_batch.id, v_batch.row_version, sync.batch_json(v_batch)::text)::sync.change_row;
          IF v_batch.pack_quantity <> v_previous.pack_quantity OR v_batch.unit_quantity <> v_previous.unit_quantity THEN
            out_changes := out_changes || sync.catalog_movement(
              p_organization_id, p_user_id, v_device_id, v_command_id, v_occurred_at, v_write, 'adjustment',
              v_batch.pack_quantity::bigint - v_previous.pack_quantity,
              v_batch.unit_quantity::bigint - v_previous.unit_quantity
            );
          END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;
  out_result := '{"_tag":"catalogWrite","rowsWritten":' || jsonb_array_length(p_command->'writes')::text || '}';
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.submit_command(
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
  v_message text;
  v_commit numeric;
  v_group text;
  v_bytes integer;
  v_page record;
  v_page_body text;
BEGIN
  IF sync.sha256_hex(sync.canonical_json(p_request->'command')) IS DISTINCT FROM v_envelope->>'payloadHash' THEN
    error_code := 'INVALID_PAYLOAD_HASH';
    error_message := 'The payload hash does not match.';
    RETURN;
  END IF;
  SELECT * INTO v_state FROM public.inventory_state AS s
  WHERE s.organization_id = v_organization_id
  FOR UPDATE;
  IF NOT FOUND OR v_state.status <> 'ready' OR v_state.release_id IS NULL THEN
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
    IF v_after IS NOT NULL THEN
      SELECT * INTO v_page FROM sync.pull(
        v_organization_id, v_envelope->>'epoch', 'operational', v_after, 100, p_page_bytes, false
      );
      IF v_page.error_code IS NULL THEN
        body := left(body, -1) || ',"page":' || v_page.body || '}';
      END IF;
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
    EXCEPTION WHEN SQLSTATE 'ZS001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_decision := 'rejected';
      v_changes := ARRAY[]::sync.change_row[];
      v_result := '{"_tag":"rejected","code":' || to_json(v_code)::text
        || ',"message":' || to_json(v_message)::text || '}';
    END;
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

  IF v_after IS NULL THEN
    RETURN;
  END IF;
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
$$;
--> statement-breakpoint
CREATE FUNCTION sync.register_replica(
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
    organization_id, status, import_id, release_id, incarnation, epoch, commit_sequence, retention_floor
  ) VALUES (v_organization_id, 'ready', 'provisioned', 'provisioned', p_incarnation, '1', 0, 0)
  ON CONFLICT (organization_id) DO NOTHING;
  SELECT * INTO v_state FROM public.inventory_state AS s
  WHERE s.organization_id = v_organization_id
  FOR UPDATE;
  IF NOT FOUND OR v_state.status <> 'ready' OR v_state.release_id IS NULL THEN
    error_code := 'EPOCH_MISMATCH';
    error_message := 'This organization inventory is not ready.';
    RETURN;
  END IF;
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
