CREATE TABLE `snapshot_staged_rows` (
	`snapshotId` text NOT NULL,
	`entity` text NOT NULL,
	`entityId` text NOT NULL,
	`rowVersion` integer NOT NULL,
	`rowJson` text NOT NULL,
	CONSTRAINT `snapshot_staged_rows_pk` PRIMARY KEY(`snapshotId`, `entity`, `entityId`)
);
--> statement-breakpoint
CREATE INDEX `snapshot_staged_rows_snapshot_id_idx` ON `snapshot_staged_rows` (`snapshotId`);
