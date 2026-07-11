CREATE TABLE `batches` (
	`id` text PRIMARY KEY,
	`productId` text NOT NULL,
	`batchNumber` text,
	`expiresAt` integer,
	`quantity` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	CONSTRAINT `fk_batches_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer
);
--> statement-breakpoint
INSERT INTO `categories` (`id`, `name`, `createdAt`, `updatedAt`)
VALUES
	('general', 'General', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
	('medicine', 'Medicine', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
	('cosmetics', 'Cosmetics', strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`categoryId` text DEFAULT 'general' NOT NULL,
	`barcode` text,
	`composition` text,
	`strength` text,
	`unitsPerPack` integer DEFAULT 1 NOT NULL,
	`costPrice` integer,
	`packPrice` integer,
	`unitPrice` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	CONSTRAINT `fk_products_categoryId_categories_id_fk` FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_idx` ON `categories` (`name`);--> statement-breakpoint
CREATE INDEX `products_category_id_idx` ON `products` (`categoryId`);
