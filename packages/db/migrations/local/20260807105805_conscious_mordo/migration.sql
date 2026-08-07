CREATE TABLE `sync_device_state` (
	`organizationId` text NOT NULL,
	`deviceId` text NOT NULL,
	`nextClientSequence` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `sync_device_state_organization_device_pk` PRIMARY KEY(`organizationId`, `deviceId`)
);
--> statement-breakpoint
INSERT INTO `sync_device_state` (`organizationId`, `deviceId`, `nextClientSequence`)
SELECT `organizationId`, `deviceId`, max(`clientSequence`) + 1
FROM `sync_outbox`
GROUP BY `organizationId`, `deviceId`;
