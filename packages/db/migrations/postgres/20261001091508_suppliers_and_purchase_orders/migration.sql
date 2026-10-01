CREATE TABLE "purchase_order_items" (
	"id" text,
	"purchase_order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"product_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"quantity_type" text DEFAULT 'pack' NOT NULL,
	"base_unit_quantity" integer NOT NULL,
	"pack_cost" integer,
	"received_base_units" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"organization_id" text,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "purchase_order_items_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" text,
	"order_number" integer NOT NULL,
	"supplier_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"sent_at" bigint,
	"expected_at" bigint,
	"total" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"organization_id" text,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "purchase_orders_organization_id_id_pk" PRIMARY KEY("organization_id","id"),
	CONSTRAINT "purchase_orders_order_number_positive" CHECK ("order_number" > 0),
	CONSTRAINT "purchase_orders_status" CHECK ("status" in ('draft', 'sent', 'closed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text,
	"name" text NOT NULL,
	"phone" text,
	"note" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"organization_id" text,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "suppliers_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "purchase_order_id" text;--> statement-breakpoint
CREATE INDEX "purchase_order_items_organization_id_purchase_order_id_idx" ON "purchase_order_items" ("organization_id","purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_order_items_organization_id_product_id_idx" ON "purchase_order_items" ("organization_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_organization_id_order_number_uidx" ON "purchase_orders" ("organization_id","order_number");--> statement-breakpoint
CREATE INDEX "purchase_orders_organization_id_supplier_id_idx" ON "purchase_orders" ("organization_id","supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_organization_id_status_created_at_idx" ON "purchase_orders" ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_organization_id_purchase_order_id_idx" ON "stock_movements" ("organization_id","purchase_order_id") WHERE "purchase_order_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_organization_id_name_uidx" ON "suppliers" ("organization_id","name");--> statement-breakpoint
CREATE INDEX "suppliers_organization_id_updated_at_idx" ON "suppliers" ("organization_id","updated_at");--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_organization_purchase_order_fk" FOREIGN KEY ("organization_id","purchase_order_id") REFERENCES "purchase_orders"("organization_id","id");--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_organization_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "products"("organization_id","id");--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "suppliers"("organization_id","id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_purchase_order_fk" FOREIGN KEY ("organization_id","purchase_order_id") REFERENCES "purchase_orders"("organization_id","id");--> statement-breakpoint
CREATE FUNCTION sync.supplier_json("s" public.suppliers) RETURNS json
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT row_to_json("r") FROM (
    SELECT
      "s"."id" AS "id",
      "s"."name" AS "name",
      "s"."phone" AS "phone",
      "s"."note" AS "note",
      "s"."created_at" AS "createdAt",
      "s"."updated_at" AS "updatedAt",
      "s"."organization_id" AS "organizationId",
      "s"."created_by_user_id" AS "createdByUserId",
      "s"."updated_by_user_id" AS "updatedByUserId",
      "s"."device_id" AS "deviceId",
      "s"."operation_id" AS "operationId",
      "s"."row_version" AS "rowVersion"
  ) AS "r"
$$;
--> statement-breakpoint
CREATE FUNCTION sync.purchase_order_json("o" public.purchase_orders) RETURNS json
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT row_to_json("r") FROM (
    SELECT
      "o"."id" AS "id",
      "o"."order_number" AS "orderNumber",
      "o"."supplier_id" AS "supplierId",
      "o"."status" AS "status",
      "o"."note" AS "note",
      "o"."sent_at" AS "sentAt",
      "o"."expected_at" AS "expectedAt",
      "o"."total" AS "total",
      "o"."created_at" AS "createdAt",
      "o"."updated_at" AS "updatedAt",
      "o"."organization_id" AS "organizationId",
      "o"."created_by_user_id" AS "createdByUserId",
      "o"."updated_by_user_id" AS "updatedByUserId",
      "o"."device_id" AS "deviceId",
      "o"."operation_id" AS "operationId",
      "o"."row_version" AS "rowVersion"
  ) AS "r"
$$;
--> statement-breakpoint
CREATE FUNCTION sync.purchase_order_item_json("i" public.purchase_order_items) RETURNS json
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT row_to_json("r") FROM (
    SELECT
      "i"."id" AS "id",
      "i"."purchase_order_id" AS "purchaseOrderId",
      "i"."product_id" AS "productId",
      "i"."product_name" AS "productName",
      "i"."quantity" AS "quantity",
      "i"."quantity_type" AS "quantityType",
      "i"."base_unit_quantity" AS "baseUnitQuantity",
      "i"."pack_cost" AS "packCost",
      "i"."received_base_units" AS "receivedBaseUnits",
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
CREATE OR REPLACE FUNCTION sync.stock_movement_json("m" public.stock_movements) RETURNS json
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT row_to_json("r") FROM (
    SELECT
      "m"."id" AS "id",
      "m"."product_id" AS "productId",
      "m"."batch_id" AS "batchId",
      "m"."invoice_id" AS "invoiceId",
      "m"."purchase_order_id" AS "purchaseOrderId",
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
CREATE FUNCTION sync.active_replicas(p_organization_id text, p_now bigint) RETURNS SETOF public.replicas
LANGUAGE sql STABLE AS $$
  SELECT r.*
  FROM public.replicas AS r
  WHERE r.organization_id = p_organization_id
    AND r.last_seen_at >= p_now - 1209600000
$$;
--> statement-breakpoint
CREATE FUNCTION sync.purchasing_gate(
  p_organization_id text,
  p_replica_id text,
  p_command jsonb,
  p_now bigint
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_label text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_command->'writes') AS w(value)
    WHERE w.value->>'entity' IN ('supplier', 'purchaseOrder', 'purchaseOrderItem')
      OR (w.value->>'entity' = 'batch' AND w.value->>'action' = 'upsert' AND w.value ? 'receipt')
  ) THEN
    RETURN;
  END IF;
  SELECT r.device_label INTO v_label
  FROM sync.active_replicas(p_organization_id, p_now) AS r
  WHERE r.replica_id <> p_replica_id AND r.schema_version < 2
  ORDER BY r.last_seen_at DESC, r.replica_id
  LIMIT 1;
  IF FOUND THEN
    PERFORM sync.reject(
      'REPLICA_SCHEMA_OUTDATED',
      'Update Tabaaq on ' || coalesce(nullif(v_label, ''), 'another device')
        || ' before using suppliers and purchase orders.'
    );
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.purchase_order_is_open(p_status text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_status IN ('draft', 'sent')
$$;
--> statement-breakpoint
CREATE FUNCTION sync.purchase_order_can_move(p_from text, p_to text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE p_from
    WHEN 'draft' THEN p_to IN ('draft', 'sent', 'cancelled')
    WHEN 'sent' THEN p_to IN ('sent', 'closed', 'cancelled')
    ELSE false
  END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.supplier_write(
  p_organization_id text,
  p_user_id text,
  p_device_id text,
  p_command_id text,
  p_occurred_at bigint,
  p_write jsonb
) RETURNS sync.change_row
LANGUAGE plpgsql AS $$
DECLARE
  v_id text := p_write->>'id';
  v_row jsonb := p_write->'row';
  v_expected bigint := (p_write->>'expectedRowVersion')::bigint;
  v_supplier public.suppliers;
  v_found boolean;
BEGIN
  SELECT * INTO v_supplier FROM public.suppliers AS s
  WHERE s.organization_id = p_organization_id AND s.id = v_id;
  v_found := FOUND;
  IF p_write->>'action' = 'delete' THEN
    IF NOT v_found THEN
      PERFORM sync.reject('ENTITY_CONFLICT', 'Supplier ' || v_id || ' is no longer available.');
    END IF;
    IF v_expected IS DISTINCT FROM v_supplier.row_version THEN
      PERFORM sync.reject('ENTITY_CONFLICT', 'Supplier ' || v_id || ' changed since it was read.');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.purchase_orders AS o
      WHERE o.organization_id = p_organization_id AND o.supplier_id = v_id
    ) THEN
      PERFORM sync.reject('SUPPLIER_HAS_ORDERS', 'This supplier has purchase orders and cannot be deleted.');
    END IF;
    DELETE FROM public.suppliers AS s
    WHERE s.organization_id = p_organization_id AND s.id = v_id
    RETURNING * INTO v_supplier;
    RETURN ROW('supplier', 'delete', v_supplier.id, v_supplier.row_version + 1, sync.supplier_json(v_supplier)::text)::sync.change_row;
  END IF;
  IF v_expected IS NULL AND v_found THEN
    PERFORM sync.reject('ENTITY_CONFLICT', 'Supplier ' || v_id || ' already exists.');
  END IF;
  IF v_expected IS NOT NULL AND NOT v_found THEN
    PERFORM sync.reject('ENTITY_CONFLICT', 'Supplier ' || v_id || ' is no longer available.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.suppliers AS s
    WHERE s.organization_id = p_organization_id AND s.name = v_row->>'name' AND s.id <> v_id
  ) THEN
    PERFORM sync.reject('ENTITY_CONFLICT', 'Supplier name ' || (v_row->>'name') || ' is already in use.');
  END IF;
  IF v_expected IS NULL THEN
    INSERT INTO public.suppliers (
      id, name, phone, note, organization_id, created_by_user_id, updated_by_user_id,
      device_id, operation_id, row_version, created_at, updated_at
    ) VALUES (
      v_id, v_row->>'name', v_row->>'phone', v_row->>'note', p_organization_id, p_user_id, p_user_id,
      p_device_id, p_command_id, 1, p_occurred_at, p_occurred_at
    )
    RETURNING * INTO v_supplier;
  ELSE
    UPDATE public.suppliers AS s
    SET name = v_row->>'name',
      phone = v_row->>'phone',
      note = v_row->>'note',
      updated_by_user_id = p_user_id,
      device_id = p_device_id,
      operation_id = p_command_id,
      row_version = v_supplier.row_version + 1,
      updated_at = p_occurred_at
    WHERE s.organization_id = p_organization_id AND s.id = v_id
    RETURNING * INTO v_supplier;
  END IF;
  RETURN ROW('supplier', 'upsert', v_supplier.id, v_supplier.row_version, sync.supplier_json(v_supplier)::text)::sync.change_row;
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.purchase_order_write(
  p_organization_id text,
  p_user_id text,
  p_device_id text,
  p_command_id text,
  p_occurred_at bigint,
  p_write jsonb
) RETURNS sync.change_row
LANGUAGE plpgsql AS $$
DECLARE
  v_id text := p_write->>'id';
  v_row jsonb := p_write->'row';
  v_expected bigint := (p_write->>'expectedRowVersion')::bigint;
  v_order public.purchase_orders;
  v_found boolean;
  v_number integer;
BEGIN
  SELECT * INTO v_order FROM public.purchase_orders AS o
  WHERE o.organization_id = p_organization_id AND o.id = v_id;
  v_found := FOUND;
  IF p_write->>'action' = 'delete' THEN
    IF NOT v_found THEN
      PERFORM sync.reject('ENTITY_CONFLICT', 'Purchase order ' || v_id || ' is no longer available.');
    END IF;
    IF v_expected IS DISTINCT FROM v_order.row_version THEN
      PERFORM sync.reject('ENTITY_CONFLICT', 'Purchase order ' || v_id || ' changed since it was read.');
    END IF;
    IF v_order.status <> 'draft' THEN
      PERFORM sync.reject('PURCHASE_ORDER_NOT_DRAFT', 'Only a draft purchase order can be deleted.');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.purchase_order_items AS i
      WHERE i.organization_id = p_organization_id AND i.purchase_order_id = v_id
    ) THEN
      PERFORM sync.reject('PURCHASE_ORDER_HAS_ITEMS', 'Remove the lines from this purchase order before deleting it.');
    END IF;
    DELETE FROM public.purchase_orders AS o
    WHERE o.organization_id = p_organization_id AND o.id = v_id
    RETURNING * INTO v_order;
    RETURN ROW('purchaseOrder', 'delete', v_order.id, v_order.row_version + 1, sync.purchase_order_json(v_order)::text)::sync.change_row;
  END IF;
  IF v_expected IS NULL THEN
    IF v_found THEN
      PERFORM sync.reject('ENTITY_CONFLICT', 'Purchase order ' || v_id || ' already exists.');
    END IF;
    IF v_row->>'status' <> 'draft' THEN
      PERFORM sync.reject('PURCHASE_ORDER_TRANSITION_INVALID', 'This purchase order cannot move to that status.');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.suppliers AS s
      WHERE s.organization_id = p_organization_id AND s.id = v_row->>'supplierId'
    ) THEN
      PERFORM sync.reject('ENTITY_RELATION_INVALID', 'Supplier ' || (v_row->>'supplierId') || ' is not available in this organization.');
    END IF;
    v_number := (v_row->>'orderNumber')::integer;
    IF EXISTS (
      SELECT 1 FROM public.purchase_orders AS o
      WHERE o.organization_id = p_organization_id AND o.order_number = v_number
    ) THEN
      SELECT coalesce(max(o.order_number), 0) + 1 INTO v_number
      FROM public.purchase_orders AS o
      WHERE o.organization_id = p_organization_id;
    END IF;
    INSERT INTO public.purchase_orders (
      id, order_number, supplier_id, status, note, sent_at, expected_at, total, organization_id,
      created_by_user_id, updated_by_user_id, device_id, operation_id, row_version, created_at, updated_at
    ) VALUES (
      v_id, v_number, v_row->>'supplierId', v_row->>'status', v_row->>'note',
      (v_row->>'sentAt')::bigint, (v_row->>'expectedAt')::bigint, (v_row->>'total')::integer, p_organization_id,
      p_user_id, p_user_id, p_device_id, p_command_id, 1, p_occurred_at, p_occurred_at
    )
    RETURNING * INTO v_order;
  ELSE
    IF NOT v_found THEN
      PERFORM sync.reject('ENTITY_CONFLICT', 'Purchase order ' || v_id || ' is no longer available.');
    END IF;
    IF NOT sync.purchase_order_is_open(v_order.status) THEN
      PERFORM sync.reject('PURCHASE_ORDER_NOT_OPEN', 'This purchase order is closed or cancelled and can no longer change.');
    END IF;
    IF NOT sync.purchase_order_can_move(v_order.status, v_row->>'status') THEN
      PERFORM sync.reject('PURCHASE_ORDER_TRANSITION_INVALID', 'This purchase order cannot move to that status.');
    END IF;
    IF v_row->>'supplierId' IS DISTINCT FROM v_order.supplier_id AND NOT EXISTS (
      SELECT 1 FROM public.suppliers AS s
      WHERE s.organization_id = p_organization_id AND s.id = v_row->>'supplierId'
    ) THEN
      PERFORM sync.reject('ENTITY_RELATION_INVALID', 'Supplier ' || (v_row->>'supplierId') || ' is not available in this organization.');
    END IF;
    UPDATE public.purchase_orders AS o
    SET supplier_id = v_row->>'supplierId',
      status = v_row->>'status',
      note = v_row->>'note',
      sent_at = (v_row->>'sentAt')::bigint,
      expected_at = (v_row->>'expectedAt')::bigint,
      total = (v_row->>'total')::integer,
      updated_by_user_id = p_user_id,
      device_id = p_device_id,
      operation_id = p_command_id,
      row_version = v_order.row_version + 1,
      updated_at = p_occurred_at
    WHERE o.organization_id = p_organization_id AND o.id = v_id
    RETURNING * INTO v_order;
  END IF;
  RETURN ROW('purchaseOrder', 'upsert', v_order.id, v_order.row_version, sync.purchase_order_json(v_order)::text)::sync.change_row;
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.purchase_order_item_write(
  p_organization_id text,
  p_user_id text,
  p_device_id text,
  p_command_id text,
  p_occurred_at bigint,
  p_write jsonb
) RETURNS sync.change_row
LANGUAGE plpgsql AS $$
DECLARE
  v_id text := p_write->>'id';
  v_row jsonb := p_write->'row';
  v_expected bigint := (p_write->>'expectedRowVersion')::bigint;
  v_item public.purchase_order_items;
  v_found boolean;
  v_order public.purchase_orders;
  v_holder public.purchase_orders;
  v_product public.products;
  v_base_units numeric;
BEGIN
  SELECT * INTO v_item FROM public.purchase_order_items AS i
  WHERE i.organization_id = p_organization_id AND i.id = v_id;
  v_found := FOUND;
  IF v_found THEN
    SELECT * INTO v_holder FROM public.purchase_orders AS o
    WHERE o.organization_id = p_organization_id AND o.id = v_item.purchase_order_id;
  END IF;
  IF p_write->>'action' = 'delete' THEN
    IF NOT v_found THEN
      PERFORM sync.reject('ENTITY_CONFLICT', 'Order line ' || v_id || ' is no longer available.');
    END IF;
    IF v_expected IS DISTINCT FROM v_item.row_version THEN
      PERFORM sync.reject('ENTITY_CONFLICT', 'Order line ' || v_id || ' changed since it was read.');
    END IF;
    IF NOT sync.purchase_order_is_open(v_holder.status) THEN
      PERFORM sync.reject('PURCHASE_ORDER_NOT_OPEN', 'This purchase order is closed or cancelled and can no longer change.');
    END IF;
    IF v_item.received_base_units > 0 THEN
      PERFORM sync.reject('PURCHASE_ORDER_ITEM_RECEIVED', 'This order line has received stock and cannot be removed or moved.');
    END IF;
    DELETE FROM public.purchase_order_items AS i
    WHERE i.organization_id = p_organization_id AND i.id = v_id
    RETURNING * INTO v_item;
    RETURN ROW('purchaseOrderItem', 'delete', v_item.id, v_item.row_version + 1, sync.purchase_order_item_json(v_item)::text)::sync.change_row;
  END IF;
  IF v_expected IS NULL AND v_found THEN
    PERFORM sync.reject('ENTITY_CONFLICT', 'Order line ' || v_id || ' already exists.');
  END IF;
  IF v_expected IS NOT NULL AND NOT v_found THEN
    PERFORM sync.reject('ENTITY_CONFLICT', 'Order line ' || v_id || ' is no longer available.');
  END IF;
  SELECT * INTO v_order FROM public.purchase_orders AS o
  WHERE o.organization_id = p_organization_id AND o.id = v_row->>'purchaseOrderId';
  IF NOT FOUND THEN
    PERFORM sync.reject('ENTITY_RELATION_INVALID', 'Purchase order ' || (v_row->>'purchaseOrderId') || ' is not available in this organization.');
  END IF;
  IF NOT sync.purchase_order_is_open(v_order.status)
    OR (v_found AND NOT sync.purchase_order_is_open(v_holder.status))
  THEN
    PERFORM sync.reject('PURCHASE_ORDER_NOT_OPEN', 'This purchase order is closed or cancelled and can no longer change.');
  END IF;
  IF v_found AND v_item.received_base_units > 0 AND (
    v_row->>'purchaseOrderId' IS DISTINCT FROM v_item.purchase_order_id
    OR v_row->>'productId' IS DISTINCT FROM v_item.product_id
  ) THEN
    PERFORM sync.reject('PURCHASE_ORDER_ITEM_RECEIVED', 'This order line has received stock and cannot be removed or moved.');
  END IF;
  SELECT * INTO v_product FROM public.products AS p
  WHERE p.organization_id = p_organization_id AND p.id = v_row->>'productId' AND p.deleted_at IS NULL;
  IF NOT FOUND THEN
    PERFORM sync.reject('ENTITY_RELATION_INVALID', 'Product ' || (v_row->>'productId') || ' is not available in this organization.');
  END IF;
  v_base_units := (v_row->>'quantity')::numeric;
  IF v_row->>'quantityType' = 'pack' THEN
    v_base_units := v_base_units * v_product.units_per_pack;
  END IF;
  IF (v_row->>'baseUnitQuantity')::numeric IS DISTINCT FROM v_base_units THEN
    PERFORM sync.reject('PURCHASE_ORDER_ITEM_QUANTITY_INVALID', 'The order line quantity does not match the product''s units per pack.');
  END IF;
  IF v_expected IS NULL THEN
    INSERT INTO public.purchase_order_items (
      id, purchase_order_id, product_id, product_name, quantity, quantity_type, base_unit_quantity,
      pack_cost, received_base_units, organization_id, created_by_user_id, updated_by_user_id,
      device_id, operation_id, row_version, created_at, updated_at
    ) VALUES (
      v_id, v_order.id, v_product.id, v_row->>'productName', (v_row->>'quantity')::integer,
      v_row->>'quantityType', (v_row->>'baseUnitQuantity')::integer, (v_row->>'packCost')::integer, 0,
      p_organization_id, p_user_id, p_user_id, p_device_id, p_command_id, 1, p_occurred_at, p_occurred_at
    )
    RETURNING * INTO v_item;
  ELSE
    UPDATE public.purchase_order_items AS i
    SET purchase_order_id = v_order.id,
      product_id = v_product.id,
      product_name = v_row->>'productName',
      quantity = (v_row->>'quantity')::integer,
      quantity_type = v_row->>'quantityType',
      base_unit_quantity = (v_row->>'baseUnitQuantity')::integer,
      pack_cost = (v_row->>'packCost')::integer,
      updated_by_user_id = p_user_id,
      device_id = p_device_id,
      operation_id = p_command_id,
      row_version = v_item.row_version + 1,
      updated_at = p_occurred_at
    WHERE i.organization_id = p_organization_id AND i.id = v_id
    RETURNING * INTO v_item;
  END IF;
  RETURN ROW('purchaseOrderItem', 'upsert', v_item.id, v_item.row_version, sync.purchase_order_item_json(v_item)::text)::sync.change_row;
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.purchase_receipt(
  p_organization_id text,
  p_user_id text,
  p_device_id text,
  p_command_id text,
  p_occurred_at bigint,
  p_write jsonb
) RETURNS public.purchase_order_items
LANGUAGE plpgsql AS $$
DECLARE
  v_item_id text := p_write->'receipt'->>'purchaseOrderItemId';
  v_row jsonb := p_write->'row';
  v_item public.purchase_order_items;
  v_status text;
  v_units_per_pack integer;
BEGIN
  SELECT * INTO v_item FROM public.purchase_order_items AS i
  WHERE i.organization_id = p_organization_id AND i.id = v_item_id;
  IF NOT FOUND THEN
    PERFORM sync.reject('ENTITY_RELATION_INVALID', 'Order line ' || v_item_id || ' is not available in this organization.');
  END IF;
  IF v_item.product_id IS DISTINCT FROM v_row->>'productId' THEN
    PERFORM sync.reject('PURCHASE_ORDER_RECEIPT_PRODUCT_MISMATCH', 'The delivered batch is for a different product than the order line.');
  END IF;
  SELECT o.status INTO v_status FROM public.purchase_orders AS o
  WHERE o.organization_id = p_organization_id AND o.id = v_item.purchase_order_id;
  IF NOT sync.purchase_order_is_open(v_status) THEN
    PERFORM sync.reject('PURCHASE_ORDER_NOT_OPEN', 'This purchase order is closed or cancelled and can no longer change.');
  END IF;
  SELECT p.units_per_pack INTO v_units_per_pack FROM public.products AS p
  WHERE p.organization_id = p_organization_id AND p.id = v_item.product_id;
  UPDATE public.purchase_order_items AS i
  SET received_base_units = i.received_base_units
      + (v_row->>'packQuantity')::bigint * v_units_per_pack + (v_row->>'unitQuantity')::bigint,
    updated_by_user_id = p_user_id,
    device_id = p_device_id,
    operation_id = p_command_id,
    row_version = v_item.row_version + 1,
    updated_at = p_occurred_at
  WHERE i.organization_id = p_organization_id AND i.id = v_item_id
  RETURNING * INTO v_item;
  RETURN v_item;
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
  p_unit_delta bigint,
  p_purchase_order_id text
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
    id, product_id, batch_id, invoice_id, purchase_order_id, type, pack_delta, unit_delta, note,
    organization_id, actor_user_id, device_id, operation_id, created_at
  ) VALUES (
    p_write->>'movementId', p_write->'row'->>'productId', p_write->>'id', NULL, p_purchase_order_id, p_type,
    p_pack_delta, p_unit_delta, p_write->>'note', p_organization_id,
    p_user_id, p_device_id, p_command_id, p_occurred_at
  )
  RETURNING * INTO v_movement;
  RETURN ROW('stockMovement', 'upsert', v_movement.id, 1, sync.stock_movement_json(v_movement)::text)::sync.change_row;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync.catalog_write_problem(w jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  v_row jsonb := w->'row';
BEGIN
  IF jsonb_typeof(w) IS DISTINCT FROM 'object' THEN RETURN 'write'; END IF;
  IF NOT sync.is_one_of(w->'entity', ARRAY['category', 'product', 'batch', 'supplier', 'purchaseOrder', 'purchaseOrderItem']) THEN
    RETURN 'entity';
  END IF;
  IF NOT sync.is_one_of(w->'action', ARRAY['upsert', 'delete']) THEN RETURN 'action'; END IF;
  IF NOT sync.is_js_string(w->'id', 1, NULL) THEN RETURN 'id'; END IF;
  IF w->>'action' = 'delete' THEN
    IF NOT sync.is_js_int(w->'expectedRowVersion', 1) THEN RETURN 'expectedRowVersion'; END IF;
    RETURN NULL;
  END IF;
  IF NOT sync.is_js_nullable_int(w->'expectedRowVersion', 1) THEN RETURN 'expectedRowVersion'; END IF;
  IF jsonb_typeof(v_row) IS DISTINCT FROM 'object' THEN RETURN 'row'; END IF;
  CASE w->>'entity'
    WHEN 'category' THEN
      IF NOT sync.is_js_string(v_row->'name', 1, 200) THEN RETURN 'row.name'; END IF;
      IF jsonb_typeof(v_row->'tracksPacks') IS DISTINCT FROM 'boolean' THEN RETURN 'row.tracksPacks'; END IF;
    WHEN 'product' THEN
      IF NOT sync.is_js_string(v_row->'name', 1, 200) THEN RETURN 'row.name'; END IF;
      IF NOT sync.is_js_string(v_row->'categoryId', 1, NULL) THEN RETURN 'row.categoryId'; END IF;
      IF NOT sync.is_js_nullable_string(v_row->'aisle', 0, NULL) THEN RETURN 'row.aisle'; END IF;
      IF NOT sync.is_js_nullable_string(v_row->'composition', 0, NULL) THEN RETURN 'row.composition'; END IF;
      IF NOT sync.is_js_nullable_string(v_row->'strength', 0, NULL) THEN RETURN 'row.strength'; END IF;
      IF NOT sync.is_js_int(v_row->'unitsPerPack', 1) THEN RETURN 'row.unitsPerPack'; END IF;
      IF NOT sync.is_js_nullable_int(v_row->'purchasePrice', 0) THEN RETURN 'row.purchasePrice'; END IF;
      IF NOT sync.is_js_nullable_int(v_row->'retailPrice', 0) THEN RETURN 'row.retailPrice'; END IF;
      IF NOT sync.is_js_nullable_int(v_row->'unitPrice', 0) THEN RETURN 'row.unitPrice'; END IF;
      IF jsonb_typeof(v_row->'visible') IS DISTINCT FROM 'boolean' THEN RETURN 'row.visible'; END IF;
    WHEN 'batch' THEN
      IF NOT sync.is_js_string(w->'movementId', 1, 200) THEN RETURN 'movementId'; END IF;
      IF NOT sync.is_js_nullable_string(w->'note', 0, 500) THEN RETURN 'note'; END IF;
      IF NOT sync.is_js_string(v_row->'productId', 1, NULL) THEN RETURN 'row.productId'; END IF;
      IF NOT sync.is_js_nullable_string(v_row->'batchNumber', 0, NULL) THEN RETURN 'row.batchNumber'; END IF;
      IF NOT sync.is_js_nullable_int(v_row->'expiresAt', 1) THEN RETURN 'row.expiresAt'; END IF;
      IF NOT sync.is_js_int(v_row->'packQuantity', 0) THEN RETURN 'row.packQuantity'; END IF;
      IF NOT sync.is_js_int(v_row->'unitQuantity', 0) THEN RETURN 'row.unitQuantity'; END IF;
      IF w ? 'receipt' THEN
        IF jsonb_typeof(w->'receipt') IS DISTINCT FROM 'object' THEN RETURN 'receipt'; END IF;
        IF NOT sync.is_js_string(w->'receipt'->'purchaseOrderItemId', 1, NULL) THEN
          RETURN 'receipt.purchaseOrderItemId';
        END IF;
      END IF;
    WHEN 'supplier' THEN
      IF NOT sync.is_js_string(v_row->'name', 1, 200) THEN RETURN 'row.name'; END IF;
      IF coalesce(
        jsonb_typeof(v_row->'phone') <> 'null'
          AND (jsonb_typeof(v_row->'phone') <> 'string' OR NOT (v_row->>'phone') ~ '^[0-9]{1,20}$'),
        true
      ) THEN
        RETURN 'row.phone';
      END IF;
      IF NOT sync.is_js_nullable_string(v_row->'note', 0, 500) THEN RETURN 'row.note'; END IF;
    WHEN 'purchaseOrder' THEN
      IF NOT sync.is_js_int(v_row->'orderNumber', 1) THEN RETURN 'row.orderNumber'; END IF;
      IF NOT sync.is_js_string(v_row->'supplierId', 1, NULL) THEN RETURN 'row.supplierId'; END IF;
      IF NOT sync.is_one_of(v_row->'status', ARRAY['draft', 'sent', 'closed', 'cancelled']) THEN
        RETURN 'row.status';
      END IF;
      IF NOT sync.is_js_nullable_string(v_row->'note', 0, 500) THEN RETURN 'row.note'; END IF;
      IF NOT sync.is_js_nullable_int(v_row->'sentAt', 1) THEN RETURN 'row.sentAt'; END IF;
      IF NOT sync.is_js_nullable_int(v_row->'expectedAt', 1) THEN RETURN 'row.expectedAt'; END IF;
      IF NOT sync.is_js_int(v_row->'total', 0) THEN RETURN 'row.total'; END IF;
    WHEN 'purchaseOrderItem' THEN
      IF NOT sync.is_js_string(v_row->'purchaseOrderId', 1, NULL) THEN RETURN 'row.purchaseOrderId'; END IF;
      IF NOT sync.is_js_string(v_row->'productId', 1, NULL) THEN RETURN 'row.productId'; END IF;
      IF NOT sync.is_js_string(v_row->'productName', 1, 200) THEN RETURN 'row.productName'; END IF;
      IF NOT sync.is_js_int(v_row->'quantity', 1) THEN RETURN 'row.quantity'; END IF;
      IF NOT sync.is_one_of(v_row->'quantityType', ARRAY['unit', 'pack']) THEN RETURN 'row.quantityType'; END IF;
      IF NOT sync.is_js_int(v_row->'baseUnitQuantity', 1) THEN RETURN 'row.baseUnitQuantity'; END IF;
      IF NOT sync.is_js_nullable_int(v_row->'packCost', 0) THEN RETURN 'row.packCost'; END IF;
  END CASE;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync.catalog_write(
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
  v_line public.purchase_order_items;
BEGIN
  out_changes := ARRAY[]::sync.change_row[];
  FOR v_write IN
    SELECT e.value FROM jsonb_array_elements(p_command->'writes') WITH ORDINALITY AS e(value, position) ORDER BY e.position
  LOOP
    v_id := v_write->>'id';
    v_row := v_write->'row';
    v_expected := (v_write->>'expectedRowVersion')::bigint;

    CASE v_write->>'entity'
    WHEN 'category' THEN
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

    WHEN 'product' THEN
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

    WHEN 'batch' THEN
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
        IF v_write ? 'receipt' AND v_expected IS NOT NULL THEN
          PERFORM sync.reject('INVALID_OPERATION', 'A delivery can only be recorded when its batch is created.');
        END IF;
        IF v_expected IS NULL THEN
          IF v_found THEN
            PERFORM sync.reject('ENTITY_CONFLICT', 'Batch ' || v_id || ' already exists.');
          END IF;
          v_line := NULL;
          IF v_write ? 'receipt' THEN
            v_line := sync.purchase_receipt(
              p_organization_id, p_user_id, v_device_id, v_command_id, v_occurred_at, v_write
            );
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
              'stock_in', v_batch.pack_quantity, v_batch.unit_quantity, v_line.purchase_order_id
            );
          END IF;
          IF v_line.id IS NOT NULL THEN
            out_changes := out_changes
              || ROW('purchaseOrderItem', 'upsert', v_line.id, v_line.row_version, sync.purchase_order_item_json(v_line)::text)::sync.change_row;
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
              v_batch.unit_quantity::bigint - v_previous.unit_quantity,
              NULL
            );
          END IF;
        END IF;
      END IF;

    WHEN 'supplier' THEN
      out_changes := out_changes || sync.supplier_write(
        p_organization_id, p_user_id, v_device_id, v_command_id, v_occurred_at, v_write
      );

    WHEN 'purchaseOrder' THEN
      out_changes := out_changes || sync.purchase_order_write(
        p_organization_id, p_user_id, v_device_id, v_command_id, v_occurred_at, v_write
      );

    WHEN 'purchaseOrderItem' THEN
      out_changes := out_changes || sync.purchase_order_item_write(
        p_organization_id, p_user_id, v_device_id, v_command_id, v_occurred_at, v_write
      );
    END CASE;
  END LOOP;
  out_result := '{"_tag":"catalogWrite","rowsWritten":' || jsonb_array_length(p_command->'writes')::text || '}';
END
$$;
--> statement-breakpoint
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
      v_organization_id, v_envelope->>'epoch', 'operational', v_after, 100, p_page_bytes, NULL::integer
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
      CASE v_command->>'_tag'
      WHEN 'issueInvoice' THEN
        SELECT e.out_result, e.out_changes INTO v_result, v_changes
        FROM sync.issue_invoice(v_organization_id, v_user_id, v_command->'payload') AS e;
      WHEN 'catalogWrite' THEN
        PERFORM sync.purchasing_gate(v_organization_id, v_replica_id, v_command->'payload', p_received_at);
        SELECT e.out_result, e.out_changes INTO v_result, v_changes
        FROM sync.catalog_write(v_organization_id, v_user_id, v_command->'payload') AS e;
      END CASE;
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
      v_organization_id, v_state.epoch, 'operational', v_after, 100, p_page_bytes, NULL::integer
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
  v_schema_version integer := coalesce((p_request->>'schemaVersion')::integer, 1);
  v_state public.inventory_state;
  v_replica public.replicas;
  v_next text;
  v_lowest integer;
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
      schema_version = v_schema_version,
      device_label = CASE WHEN p_request ? 'deviceLabel' THEN p_request->>'deviceLabel' ELSE r.device_label END
    WHERE r.organization_id = v_organization_id AND r.replica_id = v_replica_id;
    v_next := (v_replica.last_client_sequence + 1)::text;
  ELSE
    INSERT INTO public.replicas (
      organization_id, replica_id, owner_user_id, device_label, last_client_sequence,
      processed_through_client_sequence, registered_at, last_seen_at, schema_version
    ) VALUES (
      v_organization_id, v_replica_id, v_user_id, p_request->>'deviceLabel', 0, 0, p_now, p_now,
      v_schema_version
    );
    v_next := '1';
  END IF;
  SELECT min(r.schema_version) INTO v_lowest
  FROM sync.active_replicas(v_organization_id, p_now) AS r;
  body := '{"replicaId":' || to_json(v_replica_id)::text
    || ',"nextClientSequence":"' || v_next
    || '","epoch":' || to_json(v_state.epoch)::text
    || ',"incarnation":' || to_json(v_state.incarnation)::text
    || ',"retentionFloor":"' || v_state.retention_floor::text
    || '","horizon":"' || v_state.commit_sequence::text
    || '","schemaVersion":1,"lowestActiveSchemaVersion":' || coalesce(v_lowest, v_schema_version)::text || '}';
END
$$;
--> statement-breakpoint
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
    WHERE "i"."organization_id" = "org"
    UNION ALL
    SELECT 'invoiceItem', 'invoiceItem:' || "t"."id" || ':' || "t"."row_version"
    FROM "public"."invoice_items" AS "t"
    WHERE "t"."organization_id" = "org"
    UNION ALL
    SELECT 'stockMovement', 'stockMovement:' || "m"."id" || ':1'
    FROM "public"."stock_movements" AS "m"
    WHERE "m"."organization_id" = "org"
    UNION ALL
    SELECT 'supplier', 'supplier:' || "u"."id" || ':' || "u"."row_version"
    FROM "public"."suppliers" AS "u"
    WHERE "digest_version" >= 4 AND "u"."organization_id" = "org"
    UNION ALL
    SELECT 'purchaseOrder', 'purchaseOrder:' || "o"."id" || ':' || "o"."row_version"
    FROM "public"."purchase_orders" AS "o"
    WHERE "digest_version" >= 4 AND "o"."organization_id" = "org"
    UNION ALL
    SELECT 'purchaseOrderItem', 'purchaseOrderItem:' || "l"."id" || ':' || "l"."row_version"
    FROM "public"."purchase_order_items" AS "l"
    WHERE "digest_version" >= 4 AND "l"."organization_id" = "org"
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
        ('category', 1, 3),
        ('product', 2, 3),
        ('batch', 3, 3),
        ('invoice', 4, 3),
        ('invoiceItem', 5, 3),
        ('stockMovement', 6, 3),
        ('supplier', 7, 4),
        ('purchaseOrder', 8, 4),
        ('purchaseOrderItem', 9, 4)
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
  HAVING "digest_version" BETWEEN 3 AND 4
$$;
--> statement-breakpoint
CREATE FUNCTION "sync"."pull"(
  "p_organization_id" text,
  "p_epoch" text,
  "p_subscription" text,
  "p_after_commit_sequence" text,
  "p_max_groups" integer,
  "p_byte_budget" integer,
  "p_digest_version" integer,
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
  IF p_digest_version IS NOT NULL AND coalesce(v_last, v_after) >= v_state.commit_sequence THEN
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
$$;
--> statement-breakpoint
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
    UNION ALL
    SELECT 7, 'supplier', "u"."id",
      '{"entity":"supplier","entityId":' || to_json("u"."id")::text || ',"rowVersion":' || "u"."row_version" ||
      ',"row":' || "sync"."supplier_json"("u")::text || '}'
    FROM "public"."suppliers" AS "u"
    WHERE "u"."organization_id" = "org"
    UNION ALL
    SELECT 8, 'purchaseOrder', "o"."id",
      '{"entity":"purchaseOrder","entityId":' || to_json("o"."id")::text || ',"rowVersion":' || "o"."row_version" ||
      ',"row":' || "sync"."purchase_order_json"("o")::text || '}'
    FROM "public"."purchase_orders" AS "o"
    WHERE "o"."organization_id" = "org"
    UNION ALL
    SELECT 9, 'purchaseOrderItem', "l"."id",
      '{"entity":"purchaseOrderItem","entityId":' || to_json("l"."id")::text || ',"rowVersion":' || "l"."row_version" ||
      ',"row":' || "sync"."purchase_order_item_json"("l")::text || '}'
    FROM "public"."purchase_order_items" AS "l"
    WHERE "l"."organization_id" = "org"
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
          'stockMovement', count(*) FILTER (WHERE "f"."entity" = 'stockMovement'),
          'supplier', count(*) FILTER (WHERE "f"."entity" = 'supplier'),
          'purchaseOrder', count(*) FILTER (WHERE "f"."entity" = 'purchaseOrder'),
          'purchaseOrderItem', count(*) FILTER (WHERE "f"."entity" = 'purchaseOrderItem')
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
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "sync"."snapshot_manifest"("org" text, "snapshot" text, "epoch" text, "schema_version" integer) RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  WITH "job" AS (
    SELECT "j".*
    FROM "public"."snapshot_jobs" AS "j"
    WHERE "j"."organization_id" = "org" AND "j"."snapshot_id" = "snapshot"
  ),
  "counted" AS (
    SELECT "e"."entity", "e"."ordinal", "e"."since_version",
      coalesce(("j"."entity_counts_json"::jsonb ->> "e"."entity")::integer, 0) AS "row_count"
    FROM "job" AS "j"
    CROSS JOIN (
      VALUES
        ('category', 1, 3),
        ('product', 2, 3),
        ('batch', 3, 3),
        ('invoice', 4, 3),
        ('invoiceItem', 5, 3),
        ('stockMovement', 6, 3),
        ('supplier', 7, 4),
        ('purchaseOrder', 8, 4),
        ('purchaseOrderItem', 9, 4)
    ) AS "e"("entity", "ordinal", "since_version")
  ),
  "covering" AS (
    SELECT coalesce(max("c"."since_version") FILTER (WHERE "c"."row_count" > 0), 3) AS "digest_version"
    FROM "counted" AS "c"
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
        jsonb_build_object('entity', "c"."entity", 'rowCount', "c"."row_count")
        ORDER BY "c"."ordinal"
      )
      FROM "counted" AS "c"
      WHERE "c"."since_version" <= "v"."digest_version"
    ),
    'digestVersion', "v"."digest_version"
  )
  FROM "job" AS "j"
  CROSS JOIN "covering" AS "v"
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync.import_refusal(p_organization_id text) RETURNS text
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
    OR EXISTS (SELECT 1 FROM public.suppliers AS u WHERE u.organization_id = p_organization_id)
    OR EXISTS (SELECT 1 FROM public.purchase_orders AS o WHERE o.organization_id = p_organization_id)
    OR EXISTS (SELECT 1 FROM public.purchase_order_items AS l WHERE l.organization_id = p_organization_id)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync.import_stock_movement_problem(p_image jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN NOT sync.is_js_string(p_image->'productId', 1, NULL) THEN 'row.productId'
    WHEN NOT sync.is_js_string(p_image->'batchId', 1, NULL) THEN 'row.batchId'
    WHEN NOT sync.is_js_nullable_string(p_image->'invoiceId', 1, NULL) THEN 'row.invoiceId'
    WHEN p_image ? 'purchaseOrderId' AND NOT sync.is_js_nullable_string(p_image->'purchaseOrderId', 1, NULL) THEN 'row.purchaseOrderId'
    WHEN NOT sync.is_one_of(p_image->'type', ARRAY['stock_in', 'sale', 'open_pack', 'adjustment']) THEN 'row.type'
    WHEN NOT sync.is_js_int(p_image->'packDelta', -9007199254740991) THEN 'row.packDelta'
    WHEN NOT sync.is_js_int(p_image->'unitDelta', -9007199254740991) THEN 'row.unitDelta'
    WHEN jsonb_typeof(p_image->'purchaseOrderId') = 'string' AND (
      p_image->>'type' <> 'stock_in'
      OR jsonb_typeof(p_image->'invoiceId') = 'string'
      OR NOT sync.is_js_int(p_image->'packDelta', 0)
      OR NOT sync.is_js_int(p_image->'unitDelta', 0)
      OR (p_image->>'packDelta')::numeric + (p_image->>'unitDelta')::numeric = 0
    ) THEN 'row.purchaseOrderId'
    WHEN NOT sync.is_js_nullable_string(p_image->'note', 0, NULL) THEN 'row.note'
    WHEN NOT sync.is_js_string(p_image->'deviceId', 1, 200) THEN 'row.deviceId'
    WHEN NOT sync.is_js_string(p_image->'operationId', 1, 200) THEN 'row.operationId'
    WHEN NOT sync.is_js_int(p_image->'createdAt', 0) THEN 'row.createdAt'
  END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_supplier_problem(p_image jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN NOT sync.is_js_string(p_image->'name', 1, 200) THEN 'row.name'
    WHEN coalesce(
      jsonb_typeof(p_image->'phone') <> 'null'
        AND (jsonb_typeof(p_image->'phone') <> 'string' OR NOT (p_image->>'phone') ~ '^[0-9]{1,20}$'),
      true
    ) THEN 'row.phone'
    WHEN NOT sync.is_js_nullable_string(p_image->'note', 0, 500) THEN 'row.note'
    ELSE sync.import_metadata_problem(p_image)
  END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_purchase_order_problem(p_image jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN NOT sync.is_js_int(p_image->'orderNumber', 1) THEN 'row.orderNumber'
    WHEN NOT sync.is_js_string(p_image->'supplierId', 1, NULL) THEN 'row.supplierId'
    WHEN NOT sync.is_one_of(p_image->'status', ARRAY['draft', 'sent', 'closed', 'cancelled']) THEN 'row.status'
    WHEN NOT sync.is_js_nullable_string(p_image->'note', 0, 500) THEN 'row.note'
    WHEN NOT sync.is_js_nullable_int(p_image->'sentAt', 1) THEN 'row.sentAt'
    WHEN NOT sync.is_js_nullable_int(p_image->'expectedAt', 1) THEN 'row.expectedAt'
    WHEN NOT sync.is_js_int(p_image->'total', 0) THEN 'row.total'
    ELSE sync.import_metadata_problem(p_image)
  END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_purchase_order_item_problem(p_image jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN NOT sync.is_js_string(p_image->'purchaseOrderId', 1, NULL) THEN 'row.purchaseOrderId'
    WHEN NOT sync.is_js_string(p_image->'productId', 1, NULL) THEN 'row.productId'
    WHEN NOT sync.is_js_string(p_image->'productName', 1, 200) THEN 'row.productName'
    WHEN NOT sync.is_js_int(p_image->'quantity', 1) THEN 'row.quantity'
    WHEN NOT sync.is_one_of(p_image->'quantityType', ARRAY['unit', 'pack']) THEN 'row.quantityType'
    WHEN NOT sync.is_js_int(p_image->'baseUnitQuantity', 1) THEN 'row.baseUnitQuantity'
    WHEN p_image->>'quantityType' = 'unit'
      AND (p_image->>'baseUnitQuantity')::numeric <> (p_image->>'quantity')::numeric THEN 'row.baseUnitQuantity'
    WHEN p_image->>'quantityType' = 'pack'
      AND (p_image->>'baseUnitQuantity')::numeric % (p_image->>'quantity')::numeric <> 0 THEN 'row.baseUnitQuantity'
    WHEN NOT sync.is_js_nullable_int(p_image->'packCost', 0) THEN 'row.packCost'
    WHEN NOT sync.is_js_int(p_image->'receivedBaseUnits', 0) THEN 'row.receivedBaseUnits'
    ELSE sync.import_metadata_problem(p_image)
  END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_suppliers(
  p_organization_id text, p_user_id text, p_import_id text, p_now bigint
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_count bigint;
  v_label text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM sync.import_staged(p_organization_id, p_import_id) AS s
    WHERE s.entity IN ('supplier', 'purchaseOrder', 'purchaseOrderItem')
      OR (s.entity = 'stockMovement' AND jsonb_typeof(s.image->'purchaseOrderId') = 'string')
  ) THEN
    SELECT r.device_label INTO v_label
    FROM sync.active_replicas(p_organization_id, p_now) AS r
    WHERE r.schema_version < 2
    ORDER BY r.last_seen_at DESC, r.replica_id
    LIMIT 1;
    IF FOUND THEN
      PERFORM sync.reject(
        'REPLICA_SCHEMA_OUTDATED',
        'Update Tabaaq on ' || coalesce(nullif(v_label, ''), 'another device')
          || ' before moving suppliers and purchase orders into this organization.'
      );
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM sync.import_staged(p_organization_id, p_import_id) AS s
    WHERE s.entity = 'supplier'
    GROUP BY s.image->>'name'
    HAVING count(*) > 1
  ) THEN
    PERFORM sync.reject('ENTITY_CONFLICT', 'The import holds two suppliers with the same name.');
  END IF;
  INSERT INTO public.suppliers (
    id, name, phone, note, created_at, updated_at, organization_id, created_by_user_id,
    updated_by_user_id, device_id, operation_id, row_version
  )
  SELECT s.image->>'id', s.image->>'name', s.image->>'phone', s.image->>'note',
    (s.image->>'createdAt')::numeric::bigint, (s.image->>'updatedAt')::numeric::bigint,
    p_organization_id, p_user_id, p_user_id, s.image->>'deviceId', s.image->>'operationId',
    (s.image->>'rowVersion')::numeric::bigint
  FROM sync.import_staged(p_organization_id, p_import_id) AS s
  WHERE s.entity = 'supplier';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_purchase_orders(
  p_organization_id text, p_user_id text, p_import_id text, p_now bigint
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_count bigint;
  v_orphan text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM sync.import_staged(p_organization_id, p_import_id) AS s
    WHERE s.entity = 'purchaseOrder'
    GROUP BY (s.image->>'orderNumber')::numeric
    HAVING count(*) > 1
  ) THEN
    PERFORM sync.reject('ENTITY_CONFLICT', 'The import holds two purchase orders with the same number.');
  END IF;
  SELECT s.image->>'supplierId' INTO v_orphan
  FROM sync.import_staged(p_organization_id, p_import_id) AS s
  WHERE s.entity = 'purchaseOrder'
    AND NOT EXISTS (
      SELECT 1 FROM public.suppliers AS u
      WHERE u.organization_id = p_organization_id AND u.id = s.image->>'supplierId'
    )
  LIMIT 1;
  IF FOUND THEN
    PERFORM sync.reject('ENTITY_RELATION_INVALID', 'Supplier ' || v_orphan || ' is not in the import.');
  END IF;
  INSERT INTO public.purchase_orders (
    id, order_number, supplier_id, status, note, sent_at, expected_at, total, created_at,
    updated_at, organization_id, created_by_user_id, updated_by_user_id, device_id, operation_id,
    row_version
  )
  SELECT s.image->>'id', (s.image->>'orderNumber')::numeric::integer, s.image->>'supplierId',
    s.image->>'status', s.image->>'note', (s.image->>'sentAt')::numeric::bigint,
    (s.image->>'expectedAt')::numeric::bigint, (s.image->>'total')::numeric::integer,
    (s.image->>'createdAt')::numeric::bigint, (s.image->>'updatedAt')::numeric::bigint,
    p_organization_id, p_user_id, p_user_id, s.image->>'deviceId', s.image->>'operationId',
    (s.image->>'rowVersion')::numeric::bigint
  FROM sync.import_staged(p_organization_id, p_import_id) AS s
  WHERE s.entity = 'purchaseOrder';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
--> statement-breakpoint
CREATE FUNCTION sync.import_purchase_order_items(
  p_organization_id text, p_user_id text, p_import_id text, p_now bigint
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_count bigint;
  v_orphan text;
BEGIN
  SELECT s.image->>'purchaseOrderId' INTO v_orphan
  FROM sync.import_staged(p_organization_id, p_import_id) AS s
  WHERE s.entity = 'purchaseOrderItem'
    AND NOT EXISTS (
      SELECT 1 FROM public.purchase_orders AS o
      WHERE o.organization_id = p_organization_id AND o.id = s.image->>'purchaseOrderId'
    )
  LIMIT 1;
  IF FOUND THEN
    PERFORM sync.reject('ENTITY_RELATION_INVALID', 'Purchase order ' || v_orphan || ' is not in the import.');
  END IF;
  INSERT INTO public.purchase_order_items (
    id, purchase_order_id, product_id, product_name, quantity, quantity_type, base_unit_quantity,
    pack_cost, received_base_units, created_at, updated_at, organization_id, created_by_user_id,
    updated_by_user_id, device_id, operation_id, row_version
  )
  SELECT s.image->>'id', s.image->>'purchaseOrderId', s.image->>'productId', s.image->>'productName',
    (s.image->>'quantity')::numeric::integer, s.image->>'quantityType',
    (s.image->>'baseUnitQuantity')::numeric::integer, (s.image->>'packCost')::numeric::integer,
    (s.image->>'receivedBaseUnits')::numeric::integer, (s.image->>'createdAt')::numeric::bigint,
    (s.image->>'updatedAt')::numeric::bigint, p_organization_id, p_user_id, p_user_id,
    s.image->>'deviceId', s.image->>'operationId', (s.image->>'rowVersion')::numeric::bigint
  FROM sync.import_staged(p_organization_id, p_import_id) AS s
  WHERE s.entity = 'purchaseOrderItem';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync.import_stock_movements(
  p_organization_id text, p_user_id text, p_import_id text, p_now bigint
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_count bigint;
  v_orphan text;
  v_unsettled text;
BEGIN
  SELECT s.image->>'purchaseOrderId' INTO v_orphan
  FROM sync.import_staged(p_organization_id, p_import_id) AS s
  WHERE s.entity = 'stockMovement'
    AND jsonb_typeof(s.image->'purchaseOrderId') = 'string'
    AND NOT EXISTS (
      SELECT 1 FROM public.purchase_orders AS o
      WHERE o.organization_id = p_organization_id AND o.id = s.image->>'purchaseOrderId'
    )
  LIMIT 1;
  IF FOUND THEN
    PERFORM sync.reject('ENTITY_RELATION_INVALID', 'Purchase order ' || v_orphan || ' is not in the import.');
  END IF;
  INSERT INTO public.stock_movements (
    id, product_id, batch_id, invoice_id, purchase_order_id, type, pack_delta, unit_delta, note,
    organization_id, actor_user_id, device_id, operation_id, created_at
  )
  SELECT s.image->>'id', s.image->>'productId', s.image->>'batchId', s.image->>'invoiceId',
    s.image->>'purchaseOrderId', s.image->>'type', (s.image->>'packDelta')::numeric::integer,
    (s.image->>'unitDelta')::numeric::integer, s.image->>'note', p_organization_id, p_user_id,
    s.image->>'deviceId', s.image->>'operationId', (s.image->>'createdAt')::numeric::bigint
  FROM sync.import_staged(p_organization_id, p_import_id) AS s
  WHERE s.entity = 'stockMovement';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  WITH delivered AS (
    SELECT m.purchase_order_id, m.product_id,
      sum(m.pack_delta::numeric + m.unit_delta::numeric) AS least_units
    FROM public.stock_movements AS m
    WHERE m.organization_id = p_organization_id AND m.purchase_order_id IS NOT NULL
    GROUP BY m.purchase_order_id, m.product_id
  ),
  received AS (
    SELECT l.purchase_order_id, l.product_id, sum(l.received_base_units::numeric) AS units
    FROM public.purchase_order_items AS l
    WHERE l.organization_id = p_organization_id
    GROUP BY l.purchase_order_id, l.product_id
  )
  SELECT coalesce(d.purchase_order_id, r.purchase_order_id) INTO v_unsettled
  FROM delivered AS d
  FULL JOIN received AS r
    ON r.purchase_order_id = d.purchase_order_id AND r.product_id = d.product_id
  WHERE coalesce(r.units, 0) < coalesce(d.least_units, 0)
    OR (coalesce(r.units, 0) > 0 AND d.purchase_order_id IS NULL)
  LIMIT 1;
  IF FOUND THEN
    PERFORM sync.reject(
      'ENTITY_RELATION_INVALID',
      'Purchase order ' || v_unsettled || ' holds received stock that does not match its deliveries.'
    );
  END IF;
  RETURN v_count;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync.import_entities() RETURNS TABLE (
  entity text, ordinal integer, problem regproc, importer regproc
)
LANGUAGE sql STABLE AS $$
  VALUES
    ('category', 1, 'sync.import_category_problem'::regproc, 'sync.import_categories'::regproc),
    ('product', 2, 'sync.import_product_problem'::regproc, 'sync.import_products'::regproc),
    ('batch', 3, 'sync.import_batch_problem'::regproc, 'sync.import_batches'::regproc),
    ('invoice', 4, 'sync.import_invoice_problem'::regproc, 'sync.import_invoices'::regproc),
    ('invoiceItem', 5, 'sync.import_invoice_item_problem'::regproc, 'sync.import_invoice_items'::regproc),
    ('supplier', 6, 'sync.import_supplier_problem'::regproc, 'sync.import_suppliers'::regproc),
    ('purchaseOrder', 7, 'sync.import_purchase_order_problem'::regproc, 'sync.import_purchase_orders'::regproc),
    ('purchaseOrderItem', 8, 'sync.import_purchase_order_item_problem'::regproc, 'sync.import_purchase_order_items'::regproc),
    ('stockMovement', 9, 'sync.import_stock_movement_problem'::regproc, 'sync.import_stock_movements'::regproc)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync.import_digest(p_organization_id text, p_version integer) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_version = 4 THEN sync.partition_digest(p_organization_id, 4)
    WHEN p_version = 3
      AND NOT EXISTS (SELECT 1 FROM public.suppliers AS u WHERE u.organization_id = p_organization_id)
      AND NOT EXISTS (SELECT 1 FROM public.purchase_orders AS o WHERE o.organization_id = p_organization_id)
      AND NOT EXISTS (SELECT 1 FROM public.purchase_order_items AS l WHERE l.organization_id = p_organization_id)
    THEN sync.partition_digest(p_organization_id, 3)
  END
$$;
