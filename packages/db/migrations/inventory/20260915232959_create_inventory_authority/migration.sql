CREATE TABLE `batches` (
	`id` text NOT NULL,
	`productId` text NOT NULL,
	`batchNumber` text,
	`expiresAt` integer,
	`packQuantity` integer DEFAULT 0 NOT NULL,
	`unitQuantity` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	`organizationId` text NOT NULL,
	`createdByUserId` text NOT NULL,
	`updatedByUserId` text NOT NULL,
	`deviceId` text NOT NULL,
	`operationId` text NOT NULL,
	`rowVersion` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `batches_organization_id_id_pk` PRIMARY KEY(`organizationId`, `id`),
	CONSTRAINT `batches_organization_product_fk` FOREIGN KEY (`organizationId`,`productId`) REFERENCES `products`(`organizationId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text NOT NULL,
	`name` text NOT NULL,
	`tracksPacks` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
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
	`organizationId` text NOT NULL,
	`operationId` text NOT NULL,
	`replicaId` text NOT NULL,
	`clientSequence` text NOT NULL,
	`payloadHash` text NOT NULL,
	`decision` text NOT NULL,
	`commitSequence` text NOT NULL,
	`resultJson` text NOT NULL,
	`receivedAt` integer NOT NULL,
	CONSTRAINT `command_receipts_organization_operation_pk` PRIMARY KEY(`organizationId`, `operationId`)
);
--> statement-breakpoint
CREATE TABLE `inventory_changes` (
	`organizationId` text NOT NULL,
	`commitSequence` text NOT NULL,
	`ordinal` integer NOT NULL,
	`entity` text NOT NULL,
	`action` text NOT NULL,
	`entityId` text NOT NULL,
	`rowVersion` integer NOT NULL,
	`rowJson` text NOT NULL,
	CONSTRAINT `inventory_changes_organization_commit_ordinal_pk` PRIMARY KEY(`organizationId`, `commitSequence`, `ordinal`)
);
--> statement-breakpoint
CREATE TABLE `inventory_state` (
	`organizationId` text NOT NULL,
	`status` text NOT NULL,
	`epoch` text NOT NULL,
	`commitSequence` text NOT NULL,
	`retentionFloor` text NOT NULL,
	CONSTRAINT `inventory_state_organization_id_pk` PRIMARY KEY(`organizationId`)
);
--> statement-breakpoint
CREATE TABLE `inventory_transactions` (
	`organizationId` text NOT NULL,
	`commitSequence` text NOT NULL,
	`operationId` text NOT NULL,
	`decision` text NOT NULL,
	`epoch` text NOT NULL,
	CONSTRAINT `inventory_transactions_organization_commit_pk` PRIMARY KEY(`organizationId`, `commitSequence`),
	CONSTRAINT "inventory_transactions_commit_sequence_digits" CHECK("commitSequence" glob '[0-9]*')
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
	`deletedAt` integer,
	`organizationId` text NOT NULL,
	`createdByUserId` text NOT NULL,
	`updatedByUserId` text NOT NULL,
	`deviceId` text NOT NULL,
	`operationId` text NOT NULL,
	`rowVersion` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `invoice_items_organization_id_id_pk` PRIMARY KEY(`organizationId`, `id`),
	CONSTRAINT `invoice_items_organization_invoice_fk` FOREIGN KEY (`organizationId`,`invoiceId`) REFERENCES `invoices`(`organizationId`,`id`),
	CONSTRAINT `invoice_items_organization_product_fk` FOREIGN KEY (`organizationId`,`productId`) REFERENCES `products`(`organizationId`,`id`),
	CONSTRAINT `invoice_items_organization_batch_fk` FOREIGN KEY (`organizationId`,`batchId`) REFERENCES `batches`(`organizationId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text NOT NULL,
	`invoiceNumber` integer NOT NULL,
	`customerName` text,
	`total` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
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
	`deletedAt` integer,
	`organizationId` text NOT NULL,
	`createdByUserId` text NOT NULL,
	`updatedByUserId` text NOT NULL,
	`deviceId` text NOT NULL,
	`operationId` text NOT NULL,
	`rowVersion` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `products_organization_id_id_pk` PRIMARY KEY(`organizationId`, `id`),
	CONSTRAINT `products_organization_category_fk` FOREIGN KEY (`organizationId`,`categoryId`) REFERENCES `categories`(`organizationId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `replicas` (
	`organizationId` text NOT NULL,
	`replicaId` text NOT NULL,
	`ownerUserId` text NOT NULL,
	`deviceLabel` text,
	`lastClientSequence` text NOT NULL,
	CONSTRAINT `replicas_organization_id_replica_id_pk` PRIMARY KEY(`organizationId`, `replicaId`)
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
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
	CONSTRAINT `stock_movements_organization_id_id_pk` PRIMARY KEY(`organizationId`, `id`),
	CONSTRAINT `stock_movements_organization_product_fk` FOREIGN KEY (`organizationId`,`productId`) REFERENCES `products`(`organizationId`,`id`),
	CONSTRAINT `stock_movements_organization_batch_fk` FOREIGN KEY (`organizationId`,`batchId`) REFERENCES `batches`(`organizationId`,`id`),
	CONSTRAINT `stock_movements_organization_invoice_fk` FOREIGN KEY (`organizationId`,`invoiceId`) REFERENCES `invoices`(`organizationId`,`id`)
);
--> statement-breakpoint
CREATE INDEX `batches_organization_id_product_id_idx` ON `batches` (`organizationId`,`productId`);--> statement-breakpoint
CREATE INDEX `batches_organization_id_product_expiry_idx` ON `batches` (`organizationId`,`productId`,`expiresAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_organization_id_name_uidx` ON `categories` (`organizationId`,`name`) WHERE "categories"."deletedAt" is null;--> statement-breakpoint
CREATE INDEX `categories_organization_id_updated_at_idx` ON `categories` (`organizationId`,`updatedAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `command_receipts_organization_replica_sequence_uidx` ON `command_receipts` (`organizationId`,`replicaId`,`clientSequence`);--> statement-breakpoint
CREATE INDEX `inventory_transactions_organization_operation_idx` ON `inventory_transactions` (`organizationId`,`operationId`);--> statement-breakpoint
CREATE INDEX `invoice_items_organization_id_invoice_id_idx` ON `invoice_items` (`organizationId`,`invoiceId`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_organization_id_invoice_number_uidx` ON `invoices` (`organizationId`,`invoiceNumber`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_organization_id_operation_id_uidx` ON `invoices` (`organizationId`,`operationId`);--> statement-breakpoint
CREATE INDEX `invoices_organization_id_created_at_idx` ON `invoices` (`organizationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `products_organization_id_category_id_idx` ON `products` (`organizationId`,`categoryId`);--> statement-breakpoint
CREATE INDEX `products_organization_id_updated_at_idx` ON `products` (`organizationId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_product_id_idx` ON `stock_movements` (`organizationId`,`productId`);--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_batch_id_idx` ON `stock_movements` (`organizationId`,`batchId`);--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_invoice_id_idx` ON `stock_movements` (`organizationId`,`invoiceId`);--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_operation_id_idx` ON `stock_movements` (`organizationId`,`operationId`);