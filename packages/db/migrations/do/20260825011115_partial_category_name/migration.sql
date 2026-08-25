DROP INDEX `categories_organization_id_name_uidx`;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_organization_id_name_uidx` ON `categories` (`organizationId`,`name`) WHERE `deletedAt` is null;
