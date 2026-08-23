CREATE TABLE "batches" (
	"id" text,
	"product_id" text NOT NULL,
	"batch_number" text,
	"expires_at" bigint,
	"pack_quantity" integer DEFAULT 0 NOT NULL,
	"unit_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted_at" bigint,
	"organization_id" text,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "batches_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text,
	"name" text NOT NULL,
	"tracks_packs" boolean DEFAULT true NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted_at" bigint,
	"organization_id" text,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "categories_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "electric_mutation_receipts" (
	"organization_id" text,
	"operation_id" text,
	"device_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"client_sequence" bigint NOT NULL,
	"payload_hash" text NOT NULL,
	"transaction_id" bigint NOT NULL,
	"received_at" bigint NOT NULL,
	CONSTRAINT "electric_mutation_receipts_organization_operation_pk" PRIMARY KEY("organization_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE "invoice_counters" (
	"organization_id" text PRIMARY KEY,
	"last_invoice_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "invoice_counters_last_invoice_number_nonnegative" CHECK ("last_invoice_number" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" text,
	"invoice_id" text NOT NULL,
	"product_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"product_name" text NOT NULL,
	"batch_number" text,
	"quantity" integer NOT NULL,
	"quantity_type" text DEFAULT 'unit' NOT NULL,
	"base_unit_quantity" integer NOT NULL,
	"sale_price" integer NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted_at" bigint,
	"organization_id" text,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_items_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text,
	"invoice_number" integer NOT NULL,
	"customer_name" text,
	"total" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted_at" bigint,
	"organization_id" text,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "invoices_organization_id_id_pk" PRIMARY KEY("organization_id","id"),
	CONSTRAINT "invoices_invoice_number_positive" CHECK ("invoice_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text,
	"name" text NOT NULL,
	"category_id" text DEFAULT 'general' NOT NULL,
	"aisle" text,
	"composition" text,
	"strength" text,
	"units_per_pack" integer DEFAULT 1 NOT NULL,
	"pack_price" integer,
	"unit_price" integer,
	"visible" boolean DEFAULT true NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"deleted_at" bigint,
	"organization_id" text,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"row_version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "products_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" text,
	"product_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"invoice_id" text,
	"type" text NOT NULL,
	"pack_delta" integer DEFAULT 0 NOT NULL,
	"unit_delta" integer DEFAULT 0 NOT NULL,
	"note" text,
	"organization_id" text,
	"actor_user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "stock_movements_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE INDEX "batches_organization_id_product_id_idx" ON "batches" ("organization_id","product_id");--> statement-breakpoint
CREATE INDEX "batches_organization_id_product_expiry_idx" ON "batches" ("organization_id","product_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_organization_id_name_uidx" ON "categories" ("organization_id","name");--> statement-breakpoint
CREATE INDEX "categories_organization_id_updated_at_idx" ON "categories" ("organization_id","updated_at");--> statement-breakpoint
CREATE INDEX "invoice_items_organization_id_invoice_id_idx" ON "invoice_items" ("organization_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_organization_id_invoice_number_uidx" ON "invoices" ("organization_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_organization_id_operation_id_uidx" ON "invoices" ("organization_id","operation_id");--> statement-breakpoint
CREATE INDEX "invoices_organization_id_created_at_idx" ON "invoices" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "products_organization_id_category_id_idx" ON "products" ("organization_id","category_id");--> statement-breakpoint
CREATE INDEX "products_organization_id_updated_at_idx" ON "products" ("organization_id","updated_at");--> statement-breakpoint
CREATE INDEX "stock_movements_organization_id_product_id_idx" ON "stock_movements" ("organization_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_movements_organization_id_batch_id_idx" ON "stock_movements" ("organization_id","batch_id");--> statement-breakpoint
CREATE INDEX "stock_movements_organization_id_invoice_id_idx" ON "stock_movements" ("organization_id","invoice_id");--> statement-breakpoint
CREATE INDEX "stock_movements_organization_id_operation_id_idx" ON "stock_movements" ("organization_id","operation_id");--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_organization_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "products"("organization_id","id");--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_invoice_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "invoices"("organization_id","id");--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "products"("organization_id","id");--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_batch_fk" FOREIGN KEY ("organization_id","batch_id") REFERENCES "batches"("organization_id","id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_organization_category_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "categories"("organization_id","id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "products"("organization_id","id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_batch_fk" FOREIGN KEY ("organization_id","batch_id") REFERENCES "batches"("organization_id","id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_invoice_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "invoices"("organization_id","id");
