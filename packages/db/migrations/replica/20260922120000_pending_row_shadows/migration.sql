CREATE TABLE `pending_row_marks` (
	`entity` text NOT NULL,
	`entityId` text NOT NULL,
	`operationId` text NOT NULL,
	CONSTRAINT `pending_row_marks_pk` PRIMARY KEY(`entity`, `entityId`)
);
--> statement-breakpoint
CREATE TABLE `pending_row_journal` (
	`operationId` text NOT NULL,
	`entity` text NOT NULL,
	`entityId` text NOT NULL,
	`priorRowJson` text,
	CONSTRAINT `pending_row_journal_pk` PRIMARY KEY(`operationId`, `entity`, `entityId`)
);
--> statement-breakpoint
CREATE INDEX `pending_row_marks_operation_id_idx` ON `pending_row_marks` (`operationId`);
--> statement-breakpoint
CREATE INDEX `pending_row_journal_operation_id_idx` ON `pending_row_journal` (`operationId`);
--> statement-breakpoint
CREATE INDEX `pending_row_journal_entity_idx` ON `pending_row_journal` (`entity`,`entityId`);
