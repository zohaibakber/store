CREATE TABLE `auth_oauth_account` (
	`id` text PRIMARY KEY,
	`userId` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_auth_oauth_account_userId_auth_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `auth_user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `auth_organization` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`slug` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_organization_membership` (
	`id` text PRIMARY KEY,
	`organizationId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_auth_organization_membership_organizationId_auth_organization_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `auth_organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_auth_organization_membership_userId_auth_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `auth_user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `auth_session` (
	`id` text PRIMARY KEY,
	`familyId` text NOT NULL,
	`userId` text NOT NULL,
	`activeOrganizationId` text NOT NULL,
	`refreshTokenHash` text NOT NULL,
	`clientKind` text NOT NULL,
	`deviceName` text,
	`expiresAt` integer NOT NULL,
	`lastUsedAt` integer DEFAULT (unixepoch()) NOT NULL,
	`revokedAt` integer,
	`replacedBySessionId` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_auth_session_userId_auth_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `auth_user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_auth_session_activeOrganizationId_auth_organization_id_fk` FOREIGN KEY (`activeOrganizationId`) REFERENCES `auth_organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `auth_user` (
	`id` text PRIMARY KEY,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`image` text,
	`passwordHash` text,
	`emailVerifiedAt` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_oauth_account_provider_idx` ON `auth_oauth_account` (`provider`,`providerAccountId`);--> statement-breakpoint
CREATE INDEX `auth_oauth_account_user_idx` ON `auth_oauth_account` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_organization_slug_idx` ON `auth_organization` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_organization_membership_org_user_idx` ON `auth_organization_membership` (`organizationId`,`userId`);--> statement-breakpoint
CREATE INDEX `auth_organization_membership_user_idx` ON `auth_organization_membership` (`userId`);--> statement-breakpoint
CREATE INDEX `auth_session_user_idx` ON `auth_session` (`userId`);--> statement-breakpoint
CREATE INDEX `auth_session_family_idx` ON `auth_session` (`familyId`);--> statement-breakpoint
CREATE INDEX `auth_session_expiry_idx` ON `auth_session` (`expiresAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_user_email_idx` ON `auth_user` (`email`);