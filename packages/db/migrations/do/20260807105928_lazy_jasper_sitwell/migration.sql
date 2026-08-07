CREATE TABLE `sync_devices` (
	`organizationId` text NOT NULL,
	`deviceId` text NOT NULL,
	`userId` text NOT NULL,
	`protocolVersion` integer NOT NULL,
	`lastAppliedCursor` integer DEFAULT 0 NOT NULL,
	`lastSeenAt` integer NOT NULL,
	`clientPlatform` text DEFAULT 'unknown' NOT NULL,
	`clientVersion` text DEFAULT 'unknown' NOT NULL,
	`requiresBootstrap` integer DEFAULT false NOT NULL,
	CONSTRAINT `sync_devices_organization_device_pk` PRIMARY KEY(`organizationId`, `deviceId`)
);
--> statement-breakpoint
CREATE INDEX `sync_devices_organization_last_seen_idx` ON `sync_devices` (`organizationId`,`lastSeenAt`);