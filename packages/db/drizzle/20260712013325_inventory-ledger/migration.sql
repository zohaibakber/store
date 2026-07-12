CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY,
	`productId` text NOT NULL,
	`batchId` text NOT NULL,
	`invoiceId` text,
	`type` text NOT NULL,
	`packDelta` integer DEFAULT 0 NOT NULL,
	`unitDelta` integer DEFAULT 0 NOT NULL,
	`note` text,
	`createdAt` integer NOT NULL,
	CONSTRAINT `fk_stock_movements_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`),
	CONSTRAINT `fk_stock_movements_batchId_batches_id_fk` FOREIGN KEY (`batchId`) REFERENCES `batches`(`id`),
	CONSTRAINT `fk_stock_movements_invoiceId_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`)
);
--> statement-breakpoint
ALTER TABLE `batches` RENAME COLUMN `quantity` TO `unitQuantity`;--> statement-breakpoint
ALTER TABLE `invoice_items` RENAME COLUMN `unitPrice` TO `salePrice`;--> statement-breakpoint
ALTER TABLE `batches` ADD `packQuantity` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_items` ADD `quantityType` text DEFAULT 'unit' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice_items` ADD `baseUnitQuantity` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `invoice_items` SET `baseUnitQuantity` = `quantity`;--> statement-breakpoint
ALTER TABLE `products` ADD `aisle` text;--> statement-breakpoint
CREATE INDEX `stock_movements_product_id_idx` ON `stock_movements` (`productId`);--> statement-breakpoint
CREATE INDEX `stock_movements_batch_id_idx` ON `stock_movements` (`batchId`);--> statement-breakpoint
CREATE INDEX `stock_movements_invoice_id_idx` ON `stock_movements` (`invoiceId`);--> statement-breakpoint
INSERT INTO `stock_movements` (`id`, `productId`, `batchId`, `invoiceId`, `type`, `packDelta`, `unitDelta`, `note`, `createdAt`)
SELECT lower(hex(randomblob(16))), `productId`, `id`, NULL, 'stock_in', 0, `unitQuantity`, 'Opening balance migrated', `createdAt`
FROM `batches`
WHERE `unitQuantity` > 0;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `costPrice`;
