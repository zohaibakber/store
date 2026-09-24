CREATE TABLE `auth_ephemeral_record` (
	`key` text PRIMARY KEY,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_ephemeral_record_expiry_idx` ON `auth_ephemeral_record` (`expiresAt`);