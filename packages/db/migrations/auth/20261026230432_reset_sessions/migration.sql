DELETE FROM `auth_session`;--> statement-breakpoint
DELETE FROM `auth_organization_invitation` WHERE `acceptedAt` IS NULL AND `revokedAt` IS NULL;--> statement-breakpoint
DELETE FROM `auth_ephemeral_record`;
