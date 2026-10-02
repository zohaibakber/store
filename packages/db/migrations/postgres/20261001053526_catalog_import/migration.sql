CREATE TABLE "catalog_imports" (
	"organization_id" text,
	"import_id" text NOT NULL,
	"committed_by_user_id" text NOT NULL,
	"committed_at" bigint NOT NULL,
	"result_json" text NOT NULL,
	CONSTRAINT "catalog_imports_organization_id_pk" PRIMARY KEY("organization_id")
);
--> statement-breakpoint
CREATE TABLE "import_parts" (
	"organization_id" text,
	"import_id" text,
	"part_number" integer,
	"byte_length" integer NOT NULL,
	"sha256" text NOT NULL,
	"frames" jsonb NOT NULL,
	"received_at" bigint NOT NULL,
	CONSTRAINT "import_parts_pk" PRIMARY KEY("organization_id","import_id","part_number"),
	CONSTRAINT "import_parts_part_number_positive" CHECK ("part_number" > 0),
	CONSTRAINT "import_parts_byte_length_positive" CHECK ("byte_length" > 0)
);
--> statement-breakpoint
CREATE INDEX "import_parts_received_at_idx" ON "import_parts" ("received_at");
--> statement-breakpoint
CREATE FUNCTION sync.import_refusal(p_organization_id text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT 'This organization already has inventory. A device''s data can only be moved into an empty organization.'
  WHERE EXISTS (SELECT 1 FROM public.catalog_imports AS i WHERE i.organization_id = p_organization_id)
    OR EXISTS (
      SELECT 1 FROM public.inventory_state AS s
      WHERE s.organization_id = p_organization_id AND s.commit_sequence > 0
    )
    OR EXISTS (SELECT 1 FROM public.categories AS c WHERE c.organization_id = p_organization_id)
    OR EXISTS (SELECT 1 FROM public.products AS p WHERE p.organization_id = p_organization_id)
    OR EXISTS (SELECT 1 FROM public.batches AS b WHERE b.organization_id = p_organization_id)
    OR EXISTS (SELECT 1 FROM public.invoices AS i WHERE i.organization_id = p_organization_id)
    OR EXISTS (SELECT 1 FROM public.invoice_items AS t WHERE t.organization_id = p_organization_id)
    OR EXISTS (SELECT 1 FROM public.stock_movements AS m WHERE m.organization_id = p_organization_id)
$$;
--> statement-breakpoint
CREATE FUNCTION sync.stage_import_part(
  p_actor jsonb,
  p_import_id text,
  p_part_number integer,
  p_payload text,
  p_now bigint,
  p_max_bytes integer,
  p_max_rows integer,
  p_max_parts integer,
  OUT body text,
  OUT error_code text,
  OUT error_message text
)
LANGUAGE plpgsql
SET lock_timeout = '5s'
AS $$
DECLARE
  v_organization_id text := p_actor->>'organizationId';
  v_part jsonb;
  v_committed text;
BEGIN
  IF p_import_id !~ '^[A-Za-z0-9._-]{1,200}$' THEN
    error_code := 'INVALID_OPERATION';
    error_message := 'The import id is malformed.';
    RETURN;
  END IF;
  IF p_part_number NOT BETWEEN 1 AND p_max_parts THEN
    error_code := 'INVALID_OPERATION';
    error_message := 'An import holds between 1 and ' || p_max_parts || ' parts.';
    RETURN;
  END IF;
  IF octet_length(p_payload) > p_max_bytes THEN
    error_code := 'INVALID_OPERATION';
    error_message := 'An import part holds at most ' || p_max_bytes || ' bytes.';
    RETURN;
  END IF;
  BEGIN
    v_part := p_payload::jsonb;
  EXCEPTION WHEN data_exception THEN
    error_code := 'INVALID_OPERATION';
    error_message := 'The import part is not valid JSON.';
    RETURN;
  END;
  IF jsonb_typeof(v_part) IS DISTINCT FROM 'object'
    OR v_part->'snapshotId' IS DISTINCT FROM to_jsonb(p_import_id)
    OR v_part->'partNumber' IS DISTINCT FROM to_jsonb(p_part_number)
    OR jsonb_typeof(v_part->'rows') IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_part->'rows') NOT BETWEEN 1 AND p_max_rows
  THEN
    error_code := 'INVALID_OPERATION';
    error_message := 'The import part does not name this import and part, or holds no rows or more than '
      || p_max_rows || '.';
    RETURN;
  END IF;
  body := '{"partNumber":' || p_part_number
    || ',"byteLength":' || octet_length(p_payload)
    || ',"sha256":"' || sync.sha256_hex(p_payload) || '"}';
  PERFORM pg_advisory_xact_lock(hashtextextended('sync.import:' || v_organization_id, 0));
  SELECT i.import_id INTO v_committed FROM public.catalog_imports AS i
  WHERE i.organization_id = v_organization_id;
  IF v_committed IS NOT DISTINCT FROM p_import_id THEN
    RETURN;
  END IF;
  error_message := sync.import_refusal(v_organization_id);
  IF error_message IS NOT NULL THEN
    body := NULL;
    error_code := 'ENTITY_CONFLICT';
    RETURN;
  END IF;
  DELETE FROM public.import_parts AS p
  WHERE p.organization_id = v_organization_id AND p.import_id <> p_import_id;
  INSERT INTO public.import_parts AS p (
    organization_id, import_id, part_number, byte_length, sha256, frames, received_at
  ) VALUES (
    v_organization_id, p_import_id, p_part_number, octet_length(p_payload),
    sync.sha256_hex(p_payload), v_part->'rows', p_now
  )
  ON CONFLICT (organization_id, import_id, part_number) DO UPDATE SET
    byte_length = excluded.byte_length,
    sha256 = excluded.sha256,
    frames = excluded.frames,
    received_at = excluded.received_at;
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_staged(p_organization_id text, p_import_id text) RETURNS TABLE (
  entity text, entity_id text, row_version jsonb, image jsonb
)
LANGUAGE sql STABLE AS $$
  SELECT e.value->>'entity', e.value->>'entityId', e.value->'rowVersion', e.value->'row'
  FROM public.import_parts AS p
  CROSS JOIN LATERAL jsonb_array_elements(p.frames) AS e(value)
  WHERE p.organization_id = p_organization_id AND p.import_id = p_import_id
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_frame_problem(p_entity_id text, p_row_version jsonb, p_image jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_image) IS DISTINCT FROM 'object' THEN 'row'
    WHEN NOT sync.is_js_string(p_image->'id', 1, 200) OR p_image->>'id' IS DISTINCT FROM p_entity_id THEN 'entityId'
    WHEN NOT sync.is_js_int(p_row_version, 1) THEN 'rowVersion'
    WHEN p_image ? 'rowVersion' AND p_image->'rowVersion' IS DISTINCT FROM p_row_version THEN 'rowVersion'
    WHEN NOT p_image ? 'rowVersion' AND p_row_version IS DISTINCT FROM '1'::jsonb THEN 'rowVersion'
  END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_metadata_problem(p_image jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN NOT sync.is_js_int(p_image->'createdAt', 0) THEN 'row.createdAt'
    WHEN NOT sync.is_js_int(p_image->'updatedAt', 0) THEN 'row.updatedAt'
    WHEN NOT sync.is_js_string(p_image->'deviceId', 1, 200) THEN 'row.deviceId'
    WHEN NOT sync.is_js_string(p_image->'operationId', 1, 200) THEN 'row.operationId'
    WHEN NOT sync.is_js_int(p_image->'rowVersion', 1) THEN 'row.rowVersion'
  END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_category_problem(p_image jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN NOT sync.is_js_string(p_image->'name', 1, 200) THEN 'row.name'
    WHEN jsonb_typeof(p_image->'tracksPacks') IS DISTINCT FROM 'boolean' THEN 'row.tracksPacks'
    ELSE sync.import_metadata_problem(p_image)
  END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_product_problem(p_image jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN NOT sync.is_js_string(p_image->'name', 1, 200) THEN 'row.name'
    WHEN NOT sync.is_js_string(p_image->'categoryId', 1, NULL) THEN 'row.categoryId'
    WHEN NOT sync.is_js_nullable_string(p_image->'aisle', 0, NULL) THEN 'row.aisle'
    WHEN NOT sync.is_js_nullable_string(p_image->'composition', 0, NULL) THEN 'row.composition'
    WHEN NOT sync.is_js_nullable_string(p_image->'strength', 0, NULL) THEN 'row.strength'
    WHEN NOT sync.is_js_int(p_image->'unitsPerPack', 1) THEN 'row.unitsPerPack'
    WHEN NOT sync.is_js_nullable_int(p_image->'purchasePrice', 0) THEN 'row.purchasePrice'
    WHEN NOT sync.is_js_nullable_int(p_image->'retailPrice', 0) THEN 'row.retailPrice'
    WHEN NOT sync.is_js_nullable_int(p_image->'unitPrice', 0) THEN 'row.unitPrice'
    WHEN jsonb_typeof(p_image->'visible') IS DISTINCT FROM 'boolean' THEN 'row.visible'
    WHEN coalesce(jsonb_typeof(p_image->'deletedAt'), 'null') <> 'null' THEN 'row.deletedAt'
    ELSE sync.import_metadata_problem(p_image)
  END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_batch_problem(p_image jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN NOT sync.is_js_string(p_image->'productId', 1, NULL) THEN 'row.productId'
    WHEN NOT sync.is_js_nullable_string(p_image->'batchNumber', 0, NULL) THEN 'row.batchNumber'
    WHEN NOT sync.is_js_nullable_int(p_image->'expiresAt', 1) THEN 'row.expiresAt'
    WHEN NOT sync.is_js_int(p_image->'packQuantity', 0) THEN 'row.packQuantity'
    WHEN NOT sync.is_js_int(p_image->'unitQuantity', 0) THEN 'row.unitQuantity'
    WHEN coalesce(jsonb_typeof(p_image->'deletedAt'), 'null') <> 'null' THEN 'row.deletedAt'
    ELSE sync.import_metadata_problem(p_image)
  END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_invoice_problem(p_image jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN NOT sync.is_js_int(p_image->'invoiceNumber', 1) THEN 'row.invoiceNumber'
    WHEN NOT sync.is_js_nullable_string(p_image->'customerName', 0, NULL) THEN 'row.customerName'
    WHEN NOT sync.is_js_int(p_image->'total', 0) THEN 'row.total'
    ELSE sync.import_metadata_problem(p_image)
  END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_invoice_item_problem(p_image jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN NOT sync.is_js_string(p_image->'invoiceId', 1, NULL) THEN 'row.invoiceId'
    WHEN NOT sync.is_js_string(p_image->'productId', 1, NULL) THEN 'row.productId'
    WHEN NOT sync.is_js_string(p_image->'batchId', 1, NULL) THEN 'row.batchId'
    WHEN NOT sync.is_js_string(p_image->'productName', 1, NULL) THEN 'row.productName'
    WHEN NOT sync.is_js_nullable_string(p_image->'batchNumber', 0, NULL) THEN 'row.batchNumber'
    WHEN NOT sync.is_js_int(p_image->'quantity', 1) THEN 'row.quantity'
    WHEN NOT sync.is_one_of(p_image->'quantityType', ARRAY['unit', 'pack']) THEN 'row.quantityType'
    WHEN NOT sync.is_js_int(p_image->'baseUnitQuantity', 1) THEN 'row.baseUnitQuantity'
    WHEN NOT sync.is_js_int(p_image->'salePrice', 0) THEN 'row.salePrice'
    ELSE sync.import_metadata_problem(p_image)
  END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_stock_movement_problem(p_image jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN NOT sync.is_js_string(p_image->'productId', 1, NULL) THEN 'row.productId'
    WHEN NOT sync.is_js_string(p_image->'batchId', 1, NULL) THEN 'row.batchId'
    WHEN NOT sync.is_js_nullable_string(p_image->'invoiceId', 1, NULL) THEN 'row.invoiceId'
    WHEN NOT sync.is_one_of(p_image->'type', ARRAY['stock_in', 'sale', 'open_pack', 'adjustment']) THEN 'row.type'
    WHEN NOT sync.is_js_int(p_image->'packDelta', -9007199254740991) THEN 'row.packDelta'
    WHEN NOT sync.is_js_int(p_image->'unitDelta', -9007199254740991) THEN 'row.unitDelta'
    WHEN NOT sync.is_js_nullable_string(p_image->'note', 0, NULL) THEN 'row.note'
    WHEN NOT sync.is_js_string(p_image->'deviceId', 1, 200) THEN 'row.deviceId'
    WHEN NOT sync.is_js_string(p_image->'operationId', 1, 200) THEN 'row.operationId'
    WHEN NOT sync.is_js_int(p_image->'createdAt', 0) THEN 'row.createdAt'
  END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_categories(
  p_organization_id text, p_user_id text, p_import_id text, p_now bigint
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_count bigint;
BEGIN
  INSERT INTO public.categories (
    id, name, tracks_packs, created_at, updated_at, organization_id, created_by_user_id,
    updated_by_user_id, device_id, operation_id, row_version
  )
  SELECT s.image->>'id', s.image->>'name', (s.image->>'tracksPacks')::boolean,
    (s.image->>'createdAt')::numeric::bigint, (s.image->>'updatedAt')::numeric::bigint,
    p_organization_id, p_user_id, p_user_id, s.image->>'deviceId', s.image->>'operationId',
    (s.image->>'rowVersion')::numeric::bigint
  FROM sync.import_staged(p_organization_id, p_import_id) AS s
  WHERE s.entity = 'category';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_products(
  p_organization_id text, p_user_id text, p_import_id text, p_now bigint
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_count bigint;
  v_orphan text;
BEGIN
  INSERT INTO public.products (
    id, name, category_id, aisle, composition, strength, units_per_pack, purchase_price,
    retail_price, unit_price, visible, created_at, updated_at, organization_id,
    created_by_user_id, updated_by_user_id, device_id, operation_id, row_version
  )
  SELECT s.image->>'id', s.image->>'name', s.image->>'categoryId', s.image->>'aisle',
    s.image->>'composition', s.image->>'strength', (s.image->>'unitsPerPack')::numeric::integer,
    (s.image->>'purchasePrice')::numeric::integer, (s.image->>'retailPrice')::numeric::integer,
    (s.image->>'unitPrice')::numeric::integer, (s.image->>'visible')::boolean,
    (s.image->>'createdAt')::numeric::bigint, (s.image->>'updatedAt')::numeric::bigint,
    p_organization_id, p_user_id, p_user_id, s.image->>'deviceId', s.image->>'operationId',
    (s.image->>'rowVersion')::numeric::bigint
  FROM sync.import_staged(p_organization_id, p_import_id) AS s
  WHERE s.entity = 'product';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  SELECT p.category_id INTO v_orphan
  FROM public.products AS p
  WHERE p.organization_id = p_organization_id
    AND NOT EXISTS (
      SELECT 1 FROM public.categories AS c
      WHERE c.organization_id = p_organization_id AND c.id = p.category_id
    )
  LIMIT 1;
  IF FOUND THEN
    PERFORM sync.reject('ENTITY_RELATION_INVALID', 'Category ' || v_orphan || ' is not in the import.');
  END IF;
  INSERT INTO public.products (
    id, name, category_id, units_per_pack, visible, created_at, updated_at, deleted_at,
    organization_id, created_by_user_id, updated_by_user_id, device_id, operation_id, row_version
  )
  SELECT r.product_id, coalesce(r.product_name, 'Deleted product'), 'general', 1, false,
    p_now, p_now, p_now, p_organization_id, p_user_id, p_user_id, 'import', p_import_id, 1
  FROM (
    SELECT s.image->>'productId' AS product_id, max(s.image->>'productName') AS product_name
    FROM sync.import_staged(p_organization_id, p_import_id) AS s
    WHERE jsonb_typeof(s.image->'productId') = 'string'
    GROUP BY 1
  ) AS r
  WHERE NOT EXISTS (
    SELECT 1 FROM public.products AS p
    WHERE p.organization_id = p_organization_id AND p.id = r.product_id
  );
  RETURN v_count;
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_batches(
  p_organization_id text, p_user_id text, p_import_id text, p_now bigint
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_count bigint;
  v_stranded text;
BEGIN
  INSERT INTO public.batches (
    id, product_id, batch_number, expires_at, pack_quantity, unit_quantity, created_at,
    updated_at, organization_id, created_by_user_id, updated_by_user_id, device_id,
    operation_id, row_version
  )
  SELECT s.image->>'id', s.image->>'productId', s.image->>'batchNumber',
    (s.image->>'expiresAt')::numeric::bigint, (s.image->>'packQuantity')::numeric::integer,
    (s.image->>'unitQuantity')::numeric::integer, (s.image->>'createdAt')::numeric::bigint,
    (s.image->>'updatedAt')::numeric::bigint, p_organization_id, p_user_id, p_user_id,
    s.image->>'deviceId', s.image->>'operationId', (s.image->>'rowVersion')::numeric::bigint
  FROM sync.import_staged(p_organization_id, p_import_id) AS s
  WHERE s.entity = 'batch';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  SELECT b.id INTO v_stranded
  FROM public.batches AS b
  JOIN public.products AS p ON p.organization_id = b.organization_id AND p.id = b.product_id
  WHERE b.organization_id = p_organization_id
    AND p.deleted_at IS NOT NULL
    AND (b.pack_quantity > 0 OR b.unit_quantity > 0)
  LIMIT 1;
  IF FOUND THEN
    PERFORM sync.reject('ENTITY_RELATION_INVALID', 'Batch ' || v_stranded || ' holds stock for a product that is not in the import.');
  END IF;
  INSERT INTO public.batches (
    id, product_id, batch_number, pack_quantity, unit_quantity, created_at, updated_at,
    deleted_at, organization_id, created_by_user_id, updated_by_user_id, device_id,
    operation_id, row_version
  )
  SELECT r.batch_id, r.product_id, r.batch_number, 0, 0, p_now, p_now, p_now,
    p_organization_id, p_user_id, p_user_id, 'import', p_import_id, 1
  FROM (
    SELECT s.image->>'batchId' AS batch_id, max(s.image->>'productId') AS product_id,
      max(s.image->>'batchNumber') AS batch_number
    FROM sync.import_staged(p_organization_id, p_import_id) AS s
    WHERE jsonb_typeof(s.image->'batchId') = 'string'
    GROUP BY 1
  ) AS r
  WHERE NOT EXISTS (
    SELECT 1 FROM public.batches AS b
    WHERE b.organization_id = p_organization_id AND b.id = r.batch_id
  );
  RETURN v_count;
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_invoices(
  p_organization_id text, p_user_id text, p_import_id text, p_now bigint
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_count bigint;
BEGIN
  INSERT INTO public.invoices (
    id, invoice_number, customer_name, total, created_at, updated_at, organization_id,
    created_by_user_id, updated_by_user_id, device_id, operation_id, row_version
  )
  SELECT s.image->>'id', (s.image->>'invoiceNumber')::numeric::integer, s.image->>'customerName',
    (s.image->>'total')::numeric::integer, (s.image->>'createdAt')::numeric::bigint,
    (s.image->>'updatedAt')::numeric::bigint, p_organization_id, p_user_id, p_user_id,
    s.image->>'deviceId', s.image->>'operationId', (s.image->>'rowVersion')::numeric::bigint
  FROM sync.import_staged(p_organization_id, p_import_id) AS s
  WHERE s.entity = 'invoice';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_invoice_items(
  p_organization_id text, p_user_id text, p_import_id text, p_now bigint
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_count bigint;
BEGIN
  INSERT INTO public.invoice_items (
    id, invoice_id, product_id, batch_id, product_name, batch_number, quantity, quantity_type,
    base_unit_quantity, sale_price, created_at, updated_at, organization_id,
    created_by_user_id, updated_by_user_id, device_id, operation_id, row_version
  )
  SELECT s.image->>'id', s.image->>'invoiceId', s.image->>'productId', s.image->>'batchId',
    s.image->>'productName', s.image->>'batchNumber', (s.image->>'quantity')::numeric::integer,
    s.image->>'quantityType', (s.image->>'baseUnitQuantity')::numeric::integer,
    (s.image->>'salePrice')::numeric::integer, (s.image->>'createdAt')::numeric::bigint,
    (s.image->>'updatedAt')::numeric::bigint, p_organization_id, p_user_id, p_user_id,
    s.image->>'deviceId', s.image->>'operationId', (s.image->>'rowVersion')::numeric::bigint
  FROM sync.import_staged(p_organization_id, p_import_id) AS s
  WHERE s.entity = 'invoiceItem';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_stock_movements(
  p_organization_id text, p_user_id text, p_import_id text, p_now bigint
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_count bigint;
BEGIN
  INSERT INTO public.stock_movements (
    id, product_id, batch_id, invoice_id, type, pack_delta, unit_delta, note, organization_id,
    actor_user_id, device_id, operation_id, created_at
  )
  SELECT s.image->>'id', s.image->>'productId', s.image->>'batchId', s.image->>'invoiceId',
    s.image->>'type', (s.image->>'packDelta')::numeric::integer,
    (s.image->>'unitDelta')::numeric::integer, s.image->>'note', p_organization_id, p_user_id,
    s.image->>'deviceId', s.image->>'operationId', (s.image->>'createdAt')::numeric::bigint
  FROM sync.import_staged(p_organization_id, p_import_id) AS s
  WHERE s.entity = 'stockMovement';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_entities() RETURNS TABLE (
  entity text, ordinal integer, problem regproc, importer regproc
)
LANGUAGE sql STABLE AS $$
  VALUES
    ('category', 1, 'sync.import_category_problem'::regproc, 'sync.import_categories'::regproc),
    ('product', 2, 'sync.import_product_problem'::regproc, 'sync.import_products'::regproc),
    ('batch', 3, 'sync.import_batch_problem'::regproc, 'sync.import_batches'::regproc),
    ('invoice', 4, 'sync.import_invoice_problem'::regproc, 'sync.import_invoices'::regproc),
    ('invoiceItem', 5, 'sync.import_invoice_item_problem'::regproc, 'sync.import_invoice_items'::regproc),
    ('stockMovement', 6, 'sync.import_stock_movement_problem'::regproc, 'sync.import_stock_movements'::regproc)
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_digest(p_organization_id text, p_version integer) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT CASE p_version WHEN 3 THEN sync.partition_digest(p_organization_id) END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_catalog(
  p_actor jsonb,
  p_import_id text,
  p_request jsonb,
  p_now bigint,
  p_incarnation text,
  OUT body text,
  OUT fanout_epoch text,
  OUT fanout_horizon text,
  OUT error_code text,
  OUT error_message text
)
LANGUAGE plpgsql
SET lock_timeout = '5s'
AS $$
DECLARE
  v_organization_id text := p_actor->>'organizationId';
  v_user_id text := p_actor->>'userId';
  v_state public.inventory_state;
  v_done public.catalog_imports;
  v_expected integer;
  v_arrived integer;
  v_first integer;
  v_last integer;
  v_entity record;
  v_stranger text;
  v_problem text;
  v_count bigint;
  v_counts jsonb := '[]'::jsonb;
  v_digest jsonb;
  v_constraint text;
BEGIN
  IF p_import_id !~ '^[A-Za-z0-9._-]{1,200}$'
    OR NOT sync.is_js_int(p_request->'partCount', 1)
    OR NOT sync.is_js_int(p_request->'digestVersion', 1)
    OR coalesce(jsonb_typeof(p_request->'digest') <> 'string' OR NOT (p_request->>'digest') ~ '^[0-9a-f]{64}$', true)
  THEN
    error_code := 'INVALID_OPERATION';
    error_message := 'The import request is malformed.';
    RETURN;
  END IF;
  IF p_request->>'organizationId' IS DISTINCT FROM v_organization_id THEN
    error_code := 'ORGANIZATION_MISMATCH';
    error_message := 'The import does not belong to the active organization.';
    RETURN;
  END IF;
  v_expected := (p_request->>'partCount')::numeric::integer;

  PERFORM pg_advisory_xact_lock(hashtextextended('sync.import:' || v_organization_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('sync.snapshot:' || v_organization_id, 0));
  INSERT INTO public.inventory_state (
    organization_id, incarnation, epoch, commit_sequence, retention_floor
  ) VALUES (v_organization_id, p_incarnation, '1', 0, 0)
  ON CONFLICT (organization_id) DO NOTHING;
  SELECT * INTO v_state FROM public.inventory_state AS s
  WHERE s.organization_id = v_organization_id
  FOR UPDATE;

  SELECT * INTO v_done FROM public.catalog_imports AS i
  WHERE i.organization_id = v_organization_id;
  IF FOUND AND v_done.import_id = p_import_id
    AND v_done.result_json::jsonb->>'digest' = p_request->>'digest'
  THEN
    DELETE FROM public.import_parts AS p WHERE p.organization_id = v_organization_id;
    body := v_done.result_json;
    fanout_epoch := v_state.epoch;
    fanout_horizon := v_state.commit_sequence::text;
    RETURN;
  END IF;

  error_message := sync.import_refusal(v_organization_id);
  IF error_message IS NOT NULL THEN
    error_code := 'ENTITY_CONFLICT';
    RETURN;
  END IF;

  SELECT count(*), min(p.part_number), max(p.part_number) INTO v_arrived, v_first, v_last
  FROM public.import_parts AS p
  WHERE p.organization_id = v_organization_id AND p.import_id = p_import_id;
  IF v_arrived <> v_expected OR v_first <> 1 OR v_last <> v_expected THEN
    error_code := 'INVALID_OPERATION';
    error_message := 'The import is incomplete: ' || v_arrived || ' of ' || v_expected || ' parts arrived.';
    RETURN;
  END IF;

  BEGIN
    SELECT coalesce(s.entity, 'unnamed') INTO v_stranger
    FROM sync.import_staged(v_organization_id, p_import_id) AS s
    WHERE NOT EXISTS (SELECT 1 FROM sync.import_entities() AS e WHERE e.entity = s.entity)
    LIMIT 1;
    IF FOUND THEN
      PERFORM sync.reject('SCHEMA_VERSION_UNSUPPORTED', 'This server cannot import ' || v_stranger || ' rows.');
    END IF;

    FOR v_entity IN SELECT * FROM sync.import_entities() AS e ORDER BY e.ordinal LOOP
      EXECUTE format(
        'SELECT coalesce(s.entity_id, ''unnamed'') || '' at '' || coalesce('
          || 'sync.import_frame_problem(s.entity_id, s.row_version, s.image), %1$s(s.image)) '
          || 'FROM sync.import_staged($2, $3) AS s WHERE s.entity = $1 AND coalesce('
          || 'sync.import_frame_problem(s.entity_id, s.row_version, s.image), %1$s(s.image)) IS NOT NULL '
          || 'LIMIT 1',
        v_entity.problem
      ) INTO v_problem USING v_entity.entity, v_organization_id, p_import_id;
      IF v_problem IS NOT NULL THEN
        PERFORM sync.reject('INVALID_OPERATION', 'The import holds an invalid ' || v_entity.entity || ' row: ' || v_problem || '.');
      END IF;
    END LOOP;

    FOR v_entity IN SELECT * FROM sync.import_entities() AS e ORDER BY e.ordinal LOOP
      EXECUTE format('SELECT %s($1, $2, $3, $4)', v_entity.importer)
      INTO v_count USING v_organization_id, v_user_id, p_import_id, p_now;
      v_counts := v_counts || jsonb_build_object('entity', v_entity.entity, 'rowCount', v_count);
    END LOOP;

    v_digest := sync.import_digest(v_organization_id, (p_request->>'digestVersion')::numeric::integer);
    IF v_digest IS NULL THEN
      PERFORM sync.reject('SCHEMA_VERSION_UNSUPPORTED', 'This server cannot verify digest version ' || (p_request->>'digestVersion') || '.');
    END IF;
    IF v_digest->>'digest' IS DISTINCT FROM p_request->>'digest' THEN
      PERFORM sync.reject('INVALID_PAYLOAD_HASH', 'The rows that arrived do not match this device''s data. Nothing was moved.');
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'ZS001' THEN
      GET STACKED DIAGNOSTICS error_code = PG_EXCEPTION_DETAIL, error_message = MESSAGE_TEXT;
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      error_code := 'ENTITY_CONFLICT';
      error_message := CASE v_constraint
        WHEN 'categories_organization_id_name_uidx' THEN 'The import holds two categories with the same name.'
        WHEN 'invoices_organization_id_invoice_number_uidx' THEN 'The import holds two sales with the same number.'
        ELSE 'The import holds the same record twice.'
      END;
    WHEN foreign_key_violation THEN
      error_code := 'ENTITY_RELATION_INVALID';
      error_message := 'The import holds a row that refers to a record it does not contain.';
    WHEN not_null_violation OR check_violation OR data_exception THEN
      error_code := 'INVALID_OPERATION';
      error_message := 'A value in the import is out of range.';
  END;
  IF error_code IS NOT NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.download_leases AS l WHERE l.organization_id = v_organization_id;
  DELETE FROM public.snapshot_parts AS p WHERE p.organization_id = v_organization_id;
  DELETE FROM public.snapshot_jobs AS j WHERE j.organization_id = v_organization_id;
  UPDATE public.inventory_state AS s
  SET commit_sequence = 1, retention_floor = 1
  WHERE s.organization_id = v_organization_id;

  body := jsonb_build_object(
    'importId', p_import_id,
    'horizon', '1',
    'entityCounts', v_counts,
    'digest', v_digest->>'digest',
    'digestVersion', (v_digest->>'version')::integer
  )::text;
  INSERT INTO public.catalog_imports (
    organization_id, import_id, committed_by_user_id, committed_at, result_json
  ) VALUES (v_organization_id, p_import_id, v_user_id, p_now, body);
  DELETE FROM public.import_parts AS p WHERE p.organization_id = v_organization_id;
  fanout_epoch := v_state.epoch;
  fanout_horizon := '1';
END
$$;
--> statement-breakpoint
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
  "import_ttl" bigint := coalesce(("policy" ->> 'abandonedImportMillis')::bigint, 86400000);
  "import_batch" integer := coalesce(("policy" ->> 'abandonedImportBatchParts')::integer, 64);
  "swept_imports" integer := 0;
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

  BEGIN
    WITH "stale" AS (
      SELECT "p"."organization_id", "p"."import_id", "p"."part_number"
      FROM "public"."import_parts" AS "p"
      WHERE "p"."received_at" <= "at" - "import_ttl"
      ORDER BY "p"."received_at"
      LIMIT "import_batch"
    ), "gone" AS (
      DELETE FROM "public"."import_parts" AS "p"
      USING "stale"
      WHERE "p"."organization_id" = "stale"."organization_id"
        AND "p"."import_id" = "stale"."import_id"
        AND "p"."part_number" = "stale"."part_number"
      RETURNING 1
    )
    SELECT count(*) INTO "swept_imports" FROM "gone";
    IF "swept_imports" = "import_batch" THEN
      "more" := true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    "failures" := "failures" || jsonb_build_object('organizationId', NULL, 'error', SQLERRM);
  END;

  RETURN jsonb_build_object(
    'organizations', "processed",
    'published', "published",
    'retention', "reports",
    'failures', "failures",
    'sweptImportParts', "swept_imports",
    'more', "more",
    'elapsedMillis', round(extract(epoch FROM clock_timestamp() - "started") * 1000)
  );
END
$$;
