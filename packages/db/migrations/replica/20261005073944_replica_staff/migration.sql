CREATE TABLE `command_staff` (
	`operationId` text PRIMARY KEY,
	`staffId` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`pinVerifier` text NOT NULL,
	`failedAttempts` integer DEFAULT 0 NOT NULL,
	`lockedUntil` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`actorId` text,
	`subjectId` text,
	`fromStaffId` text
);
--> statement-breakpoint
CREATE TABLE `staff_settings` (
	`id` text PRIMARY KEY,
	`autoLockMinutes` integer NOT NULL,
	`recoveryVerifier` text NOT NULL,
	`recoveryFailedAttempts` integer DEFAULT 0 NOT NULL,
	`recoveryLockedUntil` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `staff_events_kind_subject_idx` ON `staff_events` (`kind`,`subjectId`);