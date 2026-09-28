ALTER TABLE `snapshot_imports` ADD COLUMN `digestVersion` integer;
--> statement-breakpoint
UPDATE `replica_coverage` SET `verifiedAt` = NULL;
