PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_invoice_items` (
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
INSERT INTO `__new_invoice_items` SELECT `id`, `invoiceId`, `productId`, `batchId`, `productName`, `batchNumber`, `quantity`, `quantityType`, `baseUnitQuantity`, `salePrice`, `createdAt`, `updatedAt`, `organizationId`, `createdByUserId`, `updatedByUserId`, `deviceId`, `operationId`, `rowVersion` FROM `invoice_items` WHERE `deletedAt` IS NULL;
--> statement-breakpoint
DROP TABLE `invoice_items`;
--> statement-breakpoint
ALTER TABLE `__new_invoice_items` RENAME TO `invoice_items`;
--> statement-breakpoint
CREATE INDEX `invoice_items_organization_id_invoice_id_idx` ON `invoice_items` (`organizationId`,`invoiceId`);
--> statement-breakpoint
CREATE TABLE `__new_stock_movements` (
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
INSERT INTO `__new_stock_movements` SELECT `id`, `productId`, `batchId`, `invoiceId`, `type`, `packDelta`, `unitDelta`, `note`, `organizationId`, `actorUserId`, `deviceId`, `operationId`, `createdAt` FROM `stock_movements`;
--> statement-breakpoint
DROP TABLE `stock_movements`;
--> statement-breakpoint
ALTER TABLE `__new_stock_movements` RENAME TO `stock_movements`;
--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_product_id_idx` ON `stock_movements` (`organizationId`,`productId`);
--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_batch_id_idx` ON `stock_movements` (`organizationId`,`batchId`);
--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_invoice_id_idx` ON `stock_movements` (`organizationId`,`invoiceId`);
--> statement-breakpoint
CREATE INDEX `stock_movements_organization_id_operation_id_idx` ON `stock_movements` (`organizationId`,`operationId`);
--> statement-breakpoint
CREATE TABLE `__new_batches` (
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
INSERT INTO `__new_batches` SELECT `id`, `productId`, `batchNumber`, `expiresAt`, `packQuantity`, `unitQuantity`, `createdAt`, `updatedAt`, `organizationId`, `createdByUserId`, `updatedByUserId`, `deviceId`, `operationId`, `rowVersion` FROM `batches` WHERE `deletedAt` IS NULL;
--> statement-breakpoint
DROP TABLE `batches`;
--> statement-breakpoint
ALTER TABLE `__new_batches` RENAME TO `batches`;
--> statement-breakpoint
CREATE INDEX `batches_organization_id_product_id_idx` ON `batches` (`organizationId`,`productId`);
--> statement-breakpoint
CREATE INDEX `batches_organization_id_product_expiry_idx` ON `batches` (`organizationId`,`productId`,`expiresAt`);
--> statement-breakpoint
CREATE TABLE `__new_products` (
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
INSERT INTO `__new_products` SELECT `id`, `name`, `categoryId`, `aisle`, `composition`, `strength`, `unitsPerPack`, `purchasePrice`, `retailPrice`, `unitPrice`, `visible`, `createdAt`, `updatedAt`, `organizationId`, `createdByUserId`, `updatedByUserId`, `deviceId`, `operationId`, `rowVersion` FROM `products` WHERE `deletedAt` IS NULL;
--> statement-breakpoint
DROP TABLE `products`;
--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;
--> statement-breakpoint
CREATE INDEX `products_organization_id_category_id_idx` ON `products` (`organizationId`,`categoryId`);
--> statement-breakpoint
CREATE INDEX `products_organization_id_updated_at_idx` ON `products` (`organizationId`,`updatedAt`);
--> statement-breakpoint
DELETE FROM `invoices` WHERE `deletedAt` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `invoices` DROP COLUMN `deletedAt`;
--> statement-breakpoint
DELETE FROM `categories` WHERE `deletedAt` IS NOT NULL;
--> statement-breakpoint
DROP INDEX `categories_organization_id_name_uidx`;
--> statement-breakpoint
ALTER TABLE `categories` DROP COLUMN `deletedAt`;
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_organization_id_name_uidx` ON `categories` (`organizationId`,`name`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
