PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_invoices` (
	`id` text PRIMARY KEY,
	`invoiceNumber` text NOT NULL,
	`customerName` text,
	`total` integer DEFAULT 0 NOT NULL,
	`organizationId` text DEFAULT 'local' NOT NULL,
	`createdByUserId` text DEFAULT 'local' NOT NULL,
	`deviceId` text DEFAULT 'local' NOT NULL,
	`operationId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer
);--> statement-breakpoint
INSERT INTO `__new_invoices` (
	`id`, `invoiceNumber`, `customerName`, `total`, `organizationId`,
	`createdByUserId`, `deviceId`, `operationId`, `createdAt`, `updatedAt`, `deletedAt`
)
SELECT
	`id`, 'legacy-' || CAST(`invoiceNumber` AS text), `customerName`, `total`, 'local',
	'local', 'local', 'legacy-' || `id`, `createdAt`, `updatedAt`, `deletedAt`
FROM `invoices`;--> statement-breakpoint
DROP TABLE `invoices`;--> statement-breakpoint
ALTER TABLE `__new_invoices` RENAME TO `invoices`;--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_invoice_number_idx` ON `invoices` (`invoiceNumber`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_operation_id_idx` ON `invoices` (`operationId`);--> statement-breakpoint
CREATE TABLE `__new_stock_movements` (
	`id` text PRIMARY KEY,
	`productId` text NOT NULL,
	`batchId` text NOT NULL,
	`invoiceId` text,
	`type` text NOT NULL,
	`packDelta` integer DEFAULT 0 NOT NULL,
	`unitDelta` integer DEFAULT 0 NOT NULL,
	`note` text,
	`organizationId` text DEFAULT 'local' NOT NULL,
	`actorUserId` text DEFAULT 'local' NOT NULL,
	`deviceId` text DEFAULT 'local' NOT NULL,
	`operationId` text NOT NULL,
	`createdAt` integer NOT NULL,
	CONSTRAINT `fk_stock_movements_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`),
	CONSTRAINT `fk_stock_movements_batchId_batches_id_fk` FOREIGN KEY (`batchId`) REFERENCES `batches`(`id`),
	CONSTRAINT `fk_stock_movements_invoiceId_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`)
);--> statement-breakpoint
INSERT INTO `__new_stock_movements` (
	`id`, `productId`, `batchId`, `invoiceId`, `type`, `packDelta`, `unitDelta`, `note`,
	`organizationId`, `actorUserId`, `deviceId`, `operationId`, `createdAt`
)
SELECT
	`id`, `productId`, `batchId`, `invoiceId`, `type`, `packDelta`, `unitDelta`, `note`,
	'local', 'local', 'local', 'legacy-' || `id`, `createdAt`
FROM `stock_movements`;--> statement-breakpoint
DROP TABLE `stock_movements`;--> statement-breakpoint
ALTER TABLE `__new_stock_movements` RENAME TO `stock_movements`;--> statement-breakpoint
CREATE INDEX `stock_movements_product_id_idx` ON `stock_movements` (`productId`);--> statement-breakpoint
CREATE INDEX `stock_movements_batch_id_idx` ON `stock_movements` (`batchId`);--> statement-breakpoint
CREATE INDEX `stock_movements_invoice_id_idx` ON `stock_movements` (`invoiceId`);--> statement-breakpoint
CREATE TRIGGER `invoices_attribution_immutable`
BEFORE UPDATE OF `organizationId`, `createdByUserId`, `deviceId`, `operationId` ON `invoices`
BEGIN
	SELECT RAISE(ABORT, 'invoice attribution is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `stock_movements_attribution_immutable`
BEFORE UPDATE OF `organizationId`, `actorUserId`, `deviceId`, `operationId` ON `stock_movements`
BEGIN
	SELECT RAISE(ABORT, 'stock movement attribution is immutable');
END;--> statement-breakpoint
PRAGMA foreign_keys=ON;
