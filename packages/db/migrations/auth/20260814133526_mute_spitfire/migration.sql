CREATE TABLE `clerk_org_binding` (
	`clerkOrganizationId` text PRIMARY KEY,
	`storeOrganizationId` text NOT NULL,
	`clerkUserId` text NOT NULL,
	`email` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clerk_org_binding_store_organization_id_idx` ON `clerk_org_binding` (`storeOrganizationId`);--> statement-breakpoint
CREATE INDEX `clerk_org_binding_email_idx` ON `clerk_org_binding` (`email`);