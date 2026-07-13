CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" text,
	"productId" text NOT NULL,
	"batchNumber" text,
	"expiresAt" bigint,
	"packQuantity" integer DEFAULT 0 NOT NULL,
	"unitQuantity" integer DEFAULT 0 NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL,
	"deletedAt" bigint,
	"organizationId" text,
	"createdByUserId" text NOT NULL,
	"updatedByUserId" text NOT NULL,
	"deviceId" text NOT NULL,
	"operationId" text NOT NULL,
	"rowVersion" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "batches_organization_id_id_pk" PRIMARY KEY("organizationId","id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text,
	"name" text NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL,
	"deletedAt" bigint,
	"organizationId" text,
	"createdByUserId" text NOT NULL,
	"updatedByUserId" text NOT NULL,
	"deviceId" text NOT NULL,
	"operationId" text NOT NULL,
	"rowVersion" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "categories_organization_id_id_pk" PRIMARY KEY("organizationId","id")
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" text,
	"invoiceId" text NOT NULL,
	"productId" text NOT NULL,
	"batchId" text NOT NULL,
	"productName" text NOT NULL,
	"batchNumber" text,
	"quantity" integer NOT NULL,
	"quantityType" text DEFAULT 'unit' NOT NULL,
	"baseUnitQuantity" integer NOT NULL,
	"salePrice" integer NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL,
	"deletedAt" bigint,
	"organizationId" text,
	"createdByUserId" text NOT NULL,
	"updatedByUserId" text NOT NULL,
	"deviceId" text NOT NULL,
	"operationId" text NOT NULL,
	"rowVersion" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_items_organization_id_id_pk" PRIMARY KEY("organizationId","id")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text,
	"invoiceNumber" text NOT NULL,
	"customerName" text,
	"total" integer DEFAULT 0 NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL,
	"deletedAt" bigint,
	"organizationId" text,
	"createdByUserId" text NOT NULL,
	"updatedByUserId" text NOT NULL,
	"deviceId" text NOT NULL,
	"operationId" text NOT NULL,
	"rowVersion" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "invoices_organization_id_id_pk" PRIMARY KEY("organizationId","id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text,
	"name" text NOT NULL,
	"categoryId" text DEFAULT 'general' NOT NULL,
	"aisle" text,
	"composition" text,
	"strength" text,
	"unitsPerPack" integer DEFAULT 1 NOT NULL,
	"packPrice" integer,
	"unitPrice" integer,
	"visible" boolean DEFAULT true NOT NULL,
	"createdAt" bigint NOT NULL,
	"updatedAt" bigint NOT NULL,
	"deletedAt" bigint,
	"organizationId" text,
	"createdByUserId" text NOT NULL,
	"updatedByUserId" text NOT NULL,
	"deviceId" text NOT NULL,
	"operationId" text NOT NULL,
	"rowVersion" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "products_organization_id_id_pk" PRIMARY KEY("organizationId","id")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" text,
	"productId" text NOT NULL,
	"batchId" text NOT NULL,
	"invoiceId" text,
	"type" text NOT NULL,
	"packDelta" integer DEFAULT 0 NOT NULL,
	"unitDelta" integer DEFAULT 0 NOT NULL,
	"note" text,
	"organizationId" text,
	"actorUserId" text NOT NULL,
	"deviceId" text NOT NULL,
	"operationId" text NOT NULL,
	"createdAt" bigint NOT NULL,
	CONSTRAINT "stock_movements_organization_id_id_pk" PRIMARY KEY("organizationId","id")
);
--> statement-breakpoint
CREATE TABLE "sync_change_log" (
	"cursor" bigserial PRIMARY KEY,
	"organizationId" text NOT NULL,
	"operationId" text NOT NULL,
	"ordinal" integer NOT NULL,
	"entity" text NOT NULL,
	"action" text NOT NULL,
	"entityId" text NOT NULL,
	"rowVersion" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"changedAt" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_inbox" (
	"organizationId" text,
	"operationId" text,
	"deviceId" text NOT NULL,
	"actorUserId" text NOT NULL,
	"clientSequence" bigint NOT NULL,
	"payloadHash" text NOT NULL,
	"appliedCursor" bigint NOT NULL,
	"receivedAt" bigint NOT NULL,
	CONSTRAINT "sync_inbox_organization_operation_pk" PRIMARY KEY("organizationId","operationId")
);
--> statement-breakpoint
CREATE TABLE "sync_outbox" (
	"operationId" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"deviceId" text NOT NULL,
	"actorUserId" text NOT NULL,
	"clientSequence" bigserial,
	"occurredAt" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"payloadHash" text NOT NULL,
	"attemptCount" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" bigint,
	"lastError" text,
	"acknowledgedAt" bigint
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"organizationId" text PRIMARY KEY,
	"cursor" bigint DEFAULT 0 NOT NULL,
	"lastSuccessAt" bigint,
	"lastAttemptAt" bigint,
	"lastError" text
);
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" ("slug");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE INDEX "batches_organization_id_product_id_idx" ON "batches" ("organizationId","productId");--> statement-breakpoint
CREATE INDEX "batches_organization_id_product_expiry_idx" ON "batches" ("organizationId","productId","expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_organization_id_name_uidx" ON "categories" ("organizationId","name");--> statement-breakpoint
CREATE INDEX "categories_organization_id_updated_at_idx" ON "categories" ("organizationId","updatedAt");--> statement-breakpoint
CREATE INDEX "invoice_items_organization_id_invoice_id_idx" ON "invoice_items" ("organizationId","invoiceId");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_organization_id_invoice_number_uidx" ON "invoices" ("organizationId","invoiceNumber");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_organization_id_operation_id_uidx" ON "invoices" ("organizationId","operationId");--> statement-breakpoint
CREATE INDEX "invoices_organization_id_created_at_idx" ON "invoices" ("organizationId","createdAt");--> statement-breakpoint
CREATE INDEX "products_organization_id_category_id_idx" ON "products" ("organizationId","categoryId");--> statement-breakpoint
CREATE INDEX "products_organization_id_updated_at_idx" ON "products" ("organizationId","updatedAt");--> statement-breakpoint
CREATE INDEX "stock_movements_organization_id_product_id_idx" ON "stock_movements" ("organizationId","productId");--> statement-breakpoint
CREATE INDEX "stock_movements_organization_id_batch_id_idx" ON "stock_movements" ("organizationId","batchId");--> statement-breakpoint
CREATE INDEX "stock_movements_organization_id_invoice_id_idx" ON "stock_movements" ("organizationId","invoiceId");--> statement-breakpoint
CREATE INDEX "stock_movements_organization_id_operation_id_idx" ON "stock_movements" ("organizationId","operationId");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_change_log_organization_operation_ordinal_uidx" ON "sync_change_log" ("organizationId","operationId","ordinal");--> statement-breakpoint
CREATE INDEX "sync_change_log_organization_cursor_idx" ON "sync_change_log" ("organizationId","cursor");--> statement-breakpoint
CREATE INDEX "sync_change_log_organization_entity_idx" ON "sync_change_log" ("organizationId","entity","entityId");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_inbox_organization_device_sequence_uidx" ON "sync_inbox" ("organizationId","deviceId","clientSequence");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_outbox_organization_device_sequence_uidx" ON "sync_outbox" ("organizationId","deviceId","clientSequence");--> statement-breakpoint
CREATE INDEX "sync_outbox_pending_idx" ON "sync_outbox" ("organizationId","acknowledgedAt","nextAttemptAt","clientSequence");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_organization_product_fk" FOREIGN KEY ("organizationId","productId") REFERENCES "products"("organizationId","id");--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_invoice_fk" FOREIGN KEY ("organizationId","invoiceId") REFERENCES "invoices"("organizationId","id");--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_product_fk" FOREIGN KEY ("organizationId","productId") REFERENCES "products"("organizationId","id");--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_batch_fk" FOREIGN KEY ("organizationId","batchId") REFERENCES "batches"("organizationId","id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_organization_category_fk" FOREIGN KEY ("organizationId","categoryId") REFERENCES "categories"("organizationId","id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_product_fk" FOREIGN KEY ("organizationId","productId") REFERENCES "products"("organizationId","id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_batch_fk" FOREIGN KEY ("organizationId","batchId") REFERENCES "batches"("organizationId","id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_invoice_fk" FOREIGN KEY ("organizationId","invoiceId") REFERENCES "invoices"("organizationId","id");