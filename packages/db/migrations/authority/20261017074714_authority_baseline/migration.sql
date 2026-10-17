CREATE TABLE `authority_changes` (
	`commitSequence` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`entity` text NOT NULL,
	`action` text NOT NULL,
	`entityId` text NOT NULL,
	`rowVersion` integer NOT NULL,
	`rowJson` text NOT NULL,
	CONSTRAINT `authority_changes_commit_ordinal_pk` PRIMARY KEY(`commitSequence`, `ordinal`),
	CONSTRAINT "authority_changes_action" CHECK("action" in ('upsert', 'delete'))
);
--> statement-breakpoint
CREATE TABLE `authority_state` (
	`id` integer PRIMARY KEY,
	`organizationId` text NOT NULL,
	`incarnation` text NOT NULL,
	`epoch` text NOT NULL,
	`commitSequence` integer NOT NULL,
	`retentionFloor` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`maintainedAt` integer,
	`adoptedFrom` text,
	CONSTRAINT "authority_state_singleton" CHECK("id" = 1),
	CONSTRAINT "authority_state_epoch" CHECK("epoch" glob '[0-9]*'),
	CONSTRAINT "authority_state_sequences" CHECK("commitSequence" >= 0 and "retentionFloor" >= 0)
);
--> statement-breakpoint
CREATE TABLE `authority_transactions` (
	`commitSequence` integer PRIMARY KEY,
	`operationId` text NOT NULL,
	`decision` text NOT NULL,
	`epoch` text NOT NULL,
	`byteLength` integer NOT NULL,
	CONSTRAINT "authority_transactions_decision" CHECK("decision" in ('accepted', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE `batches` (
	`id` text NOT NULL,
	`productId` text NOT NULL,
	`batchNumber` text,
	`expiresAt` integer,
	`packQuantity` integer DEFAULT 0 NOT NULL,
	`unitQuantity` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`organizationId` text NOT NULL,
	`createdByUserId` text NOT NULL,
	`updatedByUserId` text NOT NULL,
	`deviceId` text NOT NULL,
	`operationId` text NOT NULL,
	`rowVersion` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `batches_organization_id_id_pk` PRIMARY KEY(`organizationId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_import` (
	`id` integer PRIMARY KEY,
	`importId` text NOT NULL,
	`committedByUserId` text NOT NULL,
	`committedAt` integer NOT NULL,
	`resultJson` text NOT NULL,
	CONSTRAINT "catalog_import_singleton" CHECK("id" = 1)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text NOT NULL,
	`name` text NOT NULL,
	`tracksPacks` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`organizationId` text NOT NULL,
	`createdByUserId` text NOT NULL,
	`updatedByUserId` text NOT NULL,
	`deviceId` text NOT NULL,
	`operationId` text NOT NULL,
	`rowVersion` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `categories_organization_id_id_pk` PRIMARY KEY(`organizationId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `command_receipts` (
	`operationId` text PRIMARY KEY,
	`replicaId` text NOT NULL,
	`clientSequence` integer NOT NULL,
	`payloadHash` text NOT NULL,
	`decision` text NOT NULL,
	`commitSequence` integer NOT NULL,
	`resultJson` text NOT NULL,
	`receivedAt` integer NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "command_receipts_decision" CHECK("decision" in ('accepted', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE `download_leases` (
	`replicaId` text PRIMARY KEY,
	`snapshotId` text NOT NULL,
	`pinnedHorizon` integer NOT NULL,
	`expiresAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_parts` (
	`importId` text NOT NULL,
	`partNumber` integer NOT NULL,
	`byteLength` integer NOT NULL,
	`sha256` text NOT NULL,
	`framesJson` text NOT NULL,
	`receivedAt` integer NOT NULL,
	CONSTRAINT `import_parts_pk` PRIMARY KEY(`importId`, `partNumber`)
);
--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` text NOT NULL,
	`invoiceId` text NOT NULL,
	`productId` text NOT NULL,
	`batchId` text NOT NULL,
	`productName` text NOT NULL,
	`batchNumber` text,
	`quantity` integer NOT NULL,
	`quantityType` text DEFAULT 'unit' NOT NULL,
	`baseUnitQuantity` integer NOT NULL,
	`salePrice` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`organizationId` text NOT NULL,
	`createdByUserId` text NOT NULL,
	`updatedByUserId` text NOT NULL,
	`deviceId` text NOT NULL,
	`operationId` text NOT NULL,
	`rowVersion` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `invoice_items_organization_id_id_pk` PRIMARY KEY(`organizationId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text NOT NULL,
	`invoiceNumber` integer NOT NULL,
	`customerName` text,
	`total` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`organizationId` text NOT NULL,
	`createdByUserId` text NOT NULL,
	`updatedByUserId` text NOT NULL,
	`deviceId` text NOT NULL,
	`operationId` text NOT NULL,
	`rowVersion` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `invoices_organization_id_id_pk` PRIMARY KEY(`organizationId`, `id`),
	CONSTRAINT "invoices_invoice_number_positive" CHECK("invoiceNumber" > 0)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text NOT NULL,
	`name` text NOT NULL,
	`categoryId` text DEFAULT 'general' NOT NULL,
	`aisle` text,
	`composition` text,
	`strength` text,
	`unitsPerPack` integer DEFAULT 1 NOT NULL,
	`purchasePrice` integer,
	`retailPrice` integer,
	`unitPrice` integer,
	`visible` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`organizationId` text NOT NULL,
	`createdByUserId` text NOT NULL,
	`updatedByUserId` text NOT NULL,
	`deviceId` text NOT NULL,
	`operationId` text NOT NULL,
	`rowVersion` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `products_organization_id_id_pk` PRIMARY KEY(`organizationId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_order_items` (
	`id` text NOT NULL,
	`purchaseOrderId` text NOT NULL,
	`productId` text NOT NULL,
	`productName` text NOT NULL,
	`quantity` integer NOT NULL,
	`quantityType` text DEFAULT 'pack' NOT NULL,
	`baseUnitQuantity` integer NOT NULL,
	`packCost` integer,
	`receivedBaseUnits` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`organizationId` text NOT NULL,
	`createdByUserId` text NOT NULL,
	`updatedByUserId` text NOT NULL,
	`deviceId` text NOT NULL,
	`operationId` text NOT NULL,
	`rowVersion` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `purchase_order_items_organization_id_id_pk` PRIMARY KEY(`organizationId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text NOT NULL,
	`orderNumber` integer NOT NULL,
	`supplierId` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`note` text,
	`sentAt` integer,
	`expectedAt` integer,
	`total` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`organizationId` text NOT NULL,
	`createdByUserId` text NOT NULL,
	`updatedByUserId` text NOT NULL,
	`deviceId` text NOT NULL,
	`operationId` text NOT NULL,
	`rowVersion` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `purchase_orders_organization_id_id_pk` PRIMARY KEY(`organizationId`, `id`),
	CONSTRAINT "purchase_orders_order_number_positive" CHECK("orderNumber" > 0),
	CONSTRAINT "purchase_orders_status" CHECK("status" in ('draft', 'sent', 'closed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE `replicas` (
	`replicaId` text PRIMARY KEY,
	`ownerUserId` text NOT NULL,
	`deviceLabel` text,
	`lastClientSequence` integer NOT NULL,
	`processedThroughClientSequence` integer NOT NULL,
	`registeredAt` integer NOT NULL,
	`lastSeenAt` integer NOT NULL,
	`schemaVersion` integer DEFAULT 1 NOT NULL,
	`schemaVersionAt` integer,
	`ignoredAt` integer,
	`removedAt` integer
);
--> statement-breakpoint
CREATE TABLE `snapshot_parts` (
	`snapshotId` text NOT NULL,
	`partNumber` integer NOT NULL,
	`byteLength` integer NOT NULL,
	`sha256` text NOT NULL,
	`payloadJson` text NOT NULL,
	CONSTRAINT `snapshot_parts_pk` PRIMARY KEY(`snapshotId`, `partNumber`)
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`snapshotId` text PRIMARY KEY,
	`subscription` text NOT NULL,
	`horizon` integer NOT NULL,
	`publishedAt` integer NOT NULL,
	`entityCountsJson` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text NOT NULL,
	`productId` text NOT NULL,
	`batchId` text NOT NULL,
	`invoiceId` text,
	`purchaseOrderId` text,
	`type` text NOT NULL,
	`packDelta` integer DEFAULT 0 NOT NULL,
	`unitDelta` integer DEFAULT 0 NOT NULL,
	`note` text,
	`organizationId` text NOT NULL,
	`actorUserId` text NOT NULL,
	`deviceId` text NOT NULL,
	`operationId` text NOT NULL,
	`createdAt` integer NOT NULL,
	CONSTRAINT `stock_movements_organization_id_id_pk` PRIMARY KEY(`organizationId`, `id`)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`note` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`organizationId` text NOT NULL,
	`createdByUserId` text NOT NULL,
	`updatedByUserId` text NOT NULL,
	`deviceId` text NOT NULL,
	`operationId` text NOT NULL,
	`rowVersion` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `suppliers_organization_id_id_pk` PRIMARY KEY(`organizationId`, `id`)
);
--> statement-breakpoint
CREATE INDEX `authority_transactions_operation_idx` ON `authority_transactions` (`operationId`);--> statement-breakpoint
CREATE INDEX `authority_transactions_epoch_commit_idx` ON `authority_transactions` (`epoch`,`commitSequence`);--> statement-breakpoint
CREATE INDEX `batches_organization_id_product_id_idx` ON `batches` (`organizationId`,`productId`);--> statement-breakpoint
CREATE INDEX `batches_organization_id_product_expiry_idx` ON `batches` (`organizationId`,`productId`,`expiresAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_organization_id_name_uidx` ON `categories` (`organizationId`,`name`);--> statement-breakpoint
CREATE INDEX `categories_organization_id_updated_at_idx` ON `categories` (`organizationId`,`updatedAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `command_receipts_replica_sequence_uidx` ON `command_receipts` (`replicaId`,`clientSequence`);--> statement-breakpoint
CREATE INDEX `download_leases_snapshot_idx` ON `download_leases` (`snapshotId`);--> statement-breakpoint
CREATE INDEX `download_leases_horizon_idx` ON `download_leases` (`pinnedHorizon`);--> statement-breakpoint
CREATE INDEX `import_parts_received_at_idx` ON `import_parts` (`receivedAt`);--> statement-breakpoint
CREATE INDEX `invoice_items_organization_id_invoice_id_idx` ON `invoice_items` (`organizationId`,`invoiceId`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_organization_id_invoice_number_uidx` ON `invoices` (`organizationId`,`invoiceNumber`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_organization_id_operation_id_uidx` ON `invoices` (`organizationId`,`operationId`);--> statement-breakpoint
CREATE INDEX `invoices_organization_id_created_at_idx` ON `invoices` (`organizationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `products_organization_id_category_id_idx` ON `products` (`organizationId`,`categoryId`);--> statement-breakpoint
CREATE INDEX `products_organization_id_updated_at_idx` ON `products` (`organizationId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `purchase_order_items_organization_id_purchase_order_id_idx` ON `purchase_order_items` (`organizationId`,`purchaseOrderId`);--> statement-breakpoint
CREATE INDEX `purchase_order_items_organization_id_product_id_idx` ON `purchase_order_items` (`organizationId`,`productId`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_organization_id_order_number_uidx` ON `purchase_orders` (`organizationId`,`orderNumber`);--> statement-breakpoint
CREATE INDEX `purchase_orders_organization_id_supplier_id_idx` ON `purchase_orders` (`organizationId`,`supplierId`);--> statement-breakpoint
CREATE INDEX `purchase_orders_organization_id_status_created_at_idx` ON `purchase_orders` (`organizationId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `snapshots_horizon_idx` ON `snapshots` (`horizon`);--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_product_id_idx` ON `stock_movements` (`organizationId`,`productId`);--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_batch_id_idx` ON `stock_movements` (`organizationId`,`batchId`);--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_invoice_id_idx` ON `stock_movements` (`organizationId`,`invoiceId`);--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_operation_id_idx` ON `stock_movements` (`organizationId`,`operationId`);--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_purchase_order_id_idx` ON `stock_movements` (`organizationId`,`purchaseOrderId`) WHERE "stock_movements"."purchaseOrderId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_organization_id_name_uidx` ON `suppliers` (`organizationId`,`name`);--> statement-breakpoint
CREATE INDEX `suppliers_organization_id_updated_at_idx` ON `suppliers` (`organizationId`,`updatedAt`);