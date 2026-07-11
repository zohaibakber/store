CREATE TABLE `batches` (
	`id` text PRIMARY KEY,
	`product_id` text NOT NULL,
	`batch_number` text,
	`expires_at` integer,
	`quantity` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT `fk_batches_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`barcode` text,
	`composition` text,
	`strength` text,
	`units_per_pack` integer DEFAULT 1 NOT NULL,
	`cost_price` integer,
	`pack_price` integer,
	`unit_price` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
