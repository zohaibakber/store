CREATE TABLE `auth_organization_invitation` (
	`id` text PRIMARY KEY,
	`organizationId` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`tokenHash` text NOT NULL,
	`invitedByUserId` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`acceptedAt` integer,
	`revokedAt` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_auth_organization_invitation_organizationId_auth_organization_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `auth_organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_auth_organization_invitation_invitedByUserId_auth_user_id_fk` FOREIGN KEY (`invitedByUserId`) REFERENCES `auth_user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_organization_invitation_token_idx` ON `auth_organization_invitation` (`tokenHash`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_organization_invitation_pending_idx` ON `auth_organization_invitation` (`organizationId`,`email`) WHERE "auth_organization_invitation"."acceptedAt" IS NULL AND "auth_organization_invitation"."revokedAt" IS NULL;--> statement-breakpoint
CREATE INDEX `auth_organization_invitation_email_idx` ON `auth_organization_invitation` (`email`);--> statement-breakpoint
CREATE INDEX `auth_organization_invitation_org_idx` ON `auth_organization_invitation` (`organizationId`);