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
ALTER TABLE `replica_state` ADD `announcedSchemaVersion` integer;--> statement-breakpoint
ALTER TABLE `replica_state` ADD `lowestActiveSchemaVersion` integer;--> statement-breakpoint
ALTER TABLE `stock_movements` ADD `purchaseOrderId` text;--> statement-breakpoint
CREATE INDEX `purchase_order_items_organization_id_purchase_order_id_idx` ON `purchase_order_items` (`organizationId`,`purchaseOrderId`);--> statement-breakpoint
CREATE INDEX `purchase_order_items_organization_id_product_id_idx` ON `purchase_order_items` (`organizationId`,`productId`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_organization_id_order_number_uidx` ON `purchase_orders` (`organizationId`,`orderNumber`);--> statement-breakpoint
CREATE INDEX `purchase_orders_organization_id_supplier_id_idx` ON `purchase_orders` (`organizationId`,`supplierId`);--> statement-breakpoint
CREATE INDEX `purchase_orders_organization_id_status_created_at_idx` ON `purchase_orders` (`organizationId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_purchase_order_id_idx` ON `stock_movements` (`organizationId`,`purchaseOrderId`) WHERE `purchaseOrderId` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_organization_id_name_uidx` ON `suppliers` (`organizationId`,`name`);--> statement-breakpoint
CREATE INDEX `suppliers_organization_id_updated_at_idx` ON `suppliers` (`organizationId`,`updatedAt`);
--> statement-breakpoint
ALTER TABLE `stock_movements_standby` ADD `purchaseOrderId` text;
--> statement-breakpoint
CREATE TABLE `suppliers_standby` (
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
CREATE TABLE `purchase_orders_standby` (
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
CREATE TABLE `purchase_order_items_standby` (
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
CREATE UNIQUE INDEX `suppliers_organization_id_name_uidx__alt` ON `suppliers_standby` (`organizationId`,`name`);
--> statement-breakpoint
CREATE INDEX `suppliers_organization_id_updated_at_idx__alt` ON `suppliers_standby` (`organizationId`,`updatedAt`);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_organization_id_order_number_uidx__alt` ON `purchase_orders_standby` (`organizationId`,`orderNumber`);
--> statement-breakpoint
CREATE INDEX `purchase_orders_organization_id_supplier_id_idx__alt` ON `purchase_orders_standby` (`organizationId`,`supplierId`);
--> statement-breakpoint
CREATE INDEX `purchase_orders_organization_id_status_created_at_idx__alt` ON `purchase_orders_standby` (`organizationId`,`status`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `purchase_order_items_organization_id_purchase_order_id_idx__alt` ON `purchase_order_items_standby` (`organizationId`,`purchaseOrderId`);
--> statement-breakpoint
CREATE INDEX `purchase_order_items_organization_id_product_id_idx__alt` ON `purchase_order_items_standby` (`organizationId`,`productId`);
--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_purchase_order_id_idx__alt` ON `stock_movements_standby` (`organizationId`,`purchaseOrderId`) WHERE `purchaseOrderId` IS NOT NULL;
--> statement-breakpoint
UPDATE `snapshot_imports` SET `stage` = 'failed' WHERE `stage` NOT IN ('activated', 'failed');
--> statement-breakpoint
UPDATE `generation_state` SET `standby` = 'retired', `candidateSnapshotId` = NULL WHERE `standby` = 'candidate';
--> statement-breakpoint
UPDATE `replica_coverage` SET `verifiedAt` = NULL;
