CREATE TABLE `inventory_active_release` (
	`id` integer PRIMARY KEY,
	`releaseId` text NOT NULL,
	`activatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_inventory_active_release_releaseId_inventory_dataset_release_id_fk` FOREIGN KEY (`releaseId`) REFERENCES `inventory_dataset_release`(`id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_dataset_release` (
	`id` text PRIMARY KEY,
	`status` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`publishedAt` integer
);
--> statement-breakpoint
CREATE TABLE `inventory_release_entry` (
	`releaseId` text NOT NULL,
	`organizationId` text NOT NULL,
	`objectName` text NOT NULL,
	`importId` text NOT NULL,
	`status` text NOT NULL,
	CONSTRAINT `fk_inventory_release_entry_releaseId_inventory_dataset_release_id_fk` FOREIGN KEY (`releaseId`) REFERENCES `inventory_dataset_release`(`id`),
	CONSTRAINT `fk_inventory_release_entry_organizationId_auth_organization_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `auth_organization`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_release_entry_release_organization_uidx` ON `inventory_release_entry` (`releaseId`,`organizationId`);--> statement-breakpoint
CREATE INDEX `inventory_release_entry_organization_idx` ON `inventory_release_entry` (`organizationId`);