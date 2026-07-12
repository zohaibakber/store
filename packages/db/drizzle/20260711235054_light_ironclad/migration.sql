CREATE TABLE `invoice_items` (
	`id` text PRIMARY KEY,
	`invoiceId` text NOT NULL,
	`productId` text NOT NULL,
	`batchId` text NOT NULL,
	`productName` text NOT NULL,
	`batchNumber` text,
	`quantity` integer NOT NULL,
	`unitPrice` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	CONSTRAINT `fk_invoice_items_invoiceId_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`),
	CONSTRAINT `fk_invoice_items_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`),
	CONSTRAINT `fk_invoice_items_batchId_batches_id_fk` FOREIGN KEY (`batchId`) REFERENCES `batches`(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY,
	`invoiceNumber` integer NOT NULL,
	`customerName` text,
	`total` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer
);
--> statement-breakpoint
CREATE INDEX `batches_product_id_idx` ON `batches` (`productId`);--> statement-breakpoint
CREATE INDEX `invoice_items_invoice_id_idx` ON `invoice_items` (`invoiceId`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_invoice_number_idx` ON `invoices` (`invoiceNumber`);