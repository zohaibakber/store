CREATE TABLE `generation_journal` (
	`seq` integer PRIMARY KEY AUTOINCREMENT,
	`kind` text NOT NULL,
	`operationId` text NOT NULL,
	`commitSequence` text,
	`payloadJson` text
);
--> statement-breakpoint
CREATE TABLE `generation_state` (
	`id` text PRIMARY KEY,
	`standby` text NOT NULL,
	`candidateSnapshotId` text,
	`statsStale` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE `snapshot_imports` ADD `candidateThrough` text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `snapshot_imports` ADD `requiredThrough` text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `snapshot_imports` ADD `journalCursor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `snapshot_imports` ADD `rebuildBoundary` integer;--> statement-breakpoint
ALTER TABLE `snapshot_imports` ADD `rebuildCursor` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `categories_standby` (
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
CREATE TABLE `products_standby` (
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
CREATE TABLE `batches_standby` (
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
CREATE TABLE `invoices_standby` (
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
CREATE TABLE `invoice_items_standby` (
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
CREATE TABLE `stock_movements_standby` (
	`id` text NOT NULL,
	`productId` text NOT NULL,
	`batchId` text NOT NULL,
	`invoiceId` text,
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
CREATE TABLE `pending_row_marks_standby` (
	`entity` text NOT NULL,
	`entityId` text NOT NULL,
	`operationId` text NOT NULL,
	CONSTRAINT `pending_row_marks_pk` PRIMARY KEY(`entity`, `entityId`)
);
--> statement-breakpoint
CREATE TABLE `pending_row_journal_standby` (
	`operationId` text NOT NULL,
	`entity` text NOT NULL,
	`entityId` text NOT NULL,
	`priorRowJson` text,
	CONSTRAINT `pending_row_journal_pk` PRIMARY KEY(`operationId`, `entity`, `entityId`)
);
--> statement-breakpoint
CREATE TABLE `stock_overlays_standby` (
	`commandId` text NOT NULL,
	`batchId` text NOT NULL,
	`packDelta` integer NOT NULL,
	`unitDelta` integer NOT NULL,
	CONSTRAINT `stock_overlays_command_id_batch_id_pk` PRIMARY KEY(`commandId`, `batchId`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_organization_id_name_uidx__alt` ON `categories_standby` (`organizationId`,`name`);
--> statement-breakpoint
CREATE INDEX `categories_organization_id_updated_at_idx__alt` ON `categories_standby` (`organizationId`,`updatedAt`);
--> statement-breakpoint
CREATE INDEX `products_organization_id_category_id_idx__alt` ON `products_standby` (`organizationId`,`categoryId`);
--> statement-breakpoint
CREATE INDEX `products_organization_id_updated_at_idx__alt` ON `products_standby` (`organizationId`,`updatedAt`);
--> statement-breakpoint
CREATE INDEX `products_name_nocase_idx__alt` ON `products_standby` (`name` COLLATE NOCASE);
--> statement-breakpoint
CREATE INDEX `batches_organization_id_product_id_idx__alt` ON `batches_standby` (`organizationId`,`productId`);
--> statement-breakpoint
CREATE INDEX `batches_organization_id_product_expiry_idx__alt` ON `batches_standby` (`organizationId`,`productId`,`expiresAt`);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_organization_id_invoice_number_uidx__alt` ON `invoices_standby` (`organizationId`,`invoiceNumber`);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_organization_id_operation_id_uidx__alt` ON `invoices_standby` (`organizationId`,`operationId`);
--> statement-breakpoint
CREATE INDEX `invoices_organization_id_created_at_idx__alt` ON `invoices_standby` (`organizationId`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `invoice_items_organization_id_invoice_id_idx__alt` ON `invoice_items_standby` (`organizationId`,`invoiceId`);
--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_product_id_idx__alt` ON `stock_movements_standby` (`organizationId`,`productId`);
--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_batch_id_idx__alt` ON `stock_movements_standby` (`organizationId`,`batchId`);
--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_invoice_id_idx__alt` ON `stock_movements_standby` (`organizationId`,`invoiceId`);
--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_operation_id_idx__alt` ON `stock_movements_standby` (`organizationId`,`operationId`);
--> statement-breakpoint
CREATE INDEX `pending_row_marks_operation_id_idx__alt` ON `pending_row_marks_standby` (`operationId`);
--> statement-breakpoint
CREATE INDEX `pending_row_journal_operation_id_idx__alt` ON `pending_row_journal_standby` (`operationId`);
--> statement-breakpoint
CREATE INDEX `pending_row_journal_entity_idx__alt` ON `pending_row_journal_standby` (`entity`,`entityId`);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_overlays_command_id_batch_id_uidx__alt` ON `stock_overlays_standby` (`commandId`,`batchId`);
--> statement-breakpoint
CREATE INDEX `stock_overlays_batch_id_idx__alt` ON `stock_overlays_standby` (`batchId`);
--> statement-breakpoint
INSERT INTO `generation_state` (`id`, `standby`, `candidateSnapshotId`, `statsStale`) VALUES ('singleton', 'empty', NULL, 0);
--> statement-breakpoint
UPDATE `snapshot_imports` SET `stage` = 'failed' WHERE `stage` IN ('importing', 'caught_up');
