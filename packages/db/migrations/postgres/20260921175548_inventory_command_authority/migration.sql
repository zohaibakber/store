CREATE TABLE "command_receipts" (
	"organization_id" text,
	"operation_id" text,
	"replica_id" text NOT NULL,
	"client_sequence" numeric(20,0) NOT NULL,
	"payload_hash" text NOT NULL,
	"decision" text NOT NULL,
	"commit_sequence" numeric(20,0) NOT NULL,
	"result_json" text NOT NULL,
	"received_at" bigint NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "command_receipts_organization_operation_pk" PRIMARY KEY("organization_id","operation_id"),
	CONSTRAINT "command_receipts_decision" CHECK ("decision" in ('accepted', 'rejected')),
	CONSTRAINT "command_receipts_client_sequence_positive" CHECK ("client_sequence" > 0),
	CONSTRAINT "command_receipts_attempts_positive" CHECK ("attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "download_leases" (
	"organization_id" text,
	"replica_id" text,
	"snapshot_id" text NOT NULL,
	"pinned_horizon" numeric(20,0) NOT NULL,
	"expires_at" bigint NOT NULL,
	CONSTRAINT "download_leases_organization_id_replica_id_pk" PRIMARY KEY("organization_id","replica_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_changes" (
	"organization_id" text,
	"commit_sequence" numeric(20,0),
	"ordinal" integer,
	"entity" text NOT NULL,
	"action" text NOT NULL,
	"entity_id" text NOT NULL,
	"row_version" integer NOT NULL,
	"row_json" text NOT NULL,
	CONSTRAINT "inventory_changes_organization_commit_ordinal_pk" PRIMARY KEY("organization_id","commit_sequence","ordinal"),
	CONSTRAINT "inventory_changes_action" CHECK ("action" in ('upsert', 'delete')),
	CONSTRAINT "inventory_changes_ordinal_nonnegative" CHECK ("ordinal" >= 0),
	CONSTRAINT "inventory_changes_row_version_positive" CHECK ("row_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_state" (
	"organization_id" text,
	"status" text NOT NULL,
	"import_id" text NOT NULL,
	"release_id" text,
	"incarnation" text NOT NULL,
	"epoch" text NOT NULL,
	"commit_sequence" numeric(20,0) NOT NULL,
	"retention_floor" numeric(20,0) NOT NULL,
	CONSTRAINT "inventory_state_organization_id_pk" PRIMARY KEY("organization_id"),
	CONSTRAINT "inventory_state_status" CHECK ("status" in ('importing', 'ready')),
	CONSTRAINT "inventory_state_sequences_nonnegative" CHECK ("commit_sequence" >= 0 and "retention_floor" >= 0),
	CONSTRAINT "inventory_state_epoch_digits" CHECK ("epoch" ~ '^[0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"organization_id" text,
	"commit_sequence" numeric(20,0),
	"operation_id" text NOT NULL,
	"decision" text NOT NULL,
	"epoch" text NOT NULL,
	CONSTRAINT "inventory_transactions_organization_commit_pk" PRIMARY KEY("organization_id","commit_sequence"),
	CONSTRAINT "inventory_transactions_decision" CHECK ("decision" in ('accepted', 'rejected')),
	CONSTRAINT "inventory_transactions_epoch_digits" CHECK ("epoch" ~ '^[0-9]+$'),
	CONSTRAINT "inventory_transactions_commit_sequence_positive" CHECK ("commit_sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "replicas" (
	"organization_id" text,
	"replica_id" text,
	"owner_user_id" text NOT NULL,
	"device_label" text,
	"last_client_sequence" numeric(20,0) NOT NULL,
	"processed_through_client_sequence" numeric(20,0) NOT NULL,
	"registered_at" bigint NOT NULL,
	"last_seen_at" bigint NOT NULL,
	CONSTRAINT "replicas_organization_id_replica_id_pk" PRIMARY KEY("organization_id","replica_id"),
	CONSTRAINT "replicas_sequences_nonnegative" CHECK ("last_client_sequence" >= 0 and "processed_through_client_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "snapshot_jobs" (
	"organization_id" text,
	"snapshot_id" text,
	"subscription" text NOT NULL,
	"stage" text NOT NULL,
	"fence" integer NOT NULL,
	"owner_token" text,
	"started_at_commit_sequence" numeric(20,0) NOT NULL,
	"horizon" numeric(20,0),
	"copy_entity" text,
	"copy_cursor" text,
	"step_due_at" bigint NOT NULL,
	CONSTRAINT "snapshot_jobs_organization_id_snapshot_id_pk" PRIMARY KEY("organization_id","snapshot_id"),
	CONSTRAINT "snapshot_jobs_stage" CHECK ("stage" in ('copying', 'repairing', 'frozen', 'exporting', 'published', 'failed')),
	CONSTRAINT "snapshot_jobs_fence_nonnegative" CHECK ("fence" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "command_receipts_organization_replica_sequence_uidx" ON "command_receipts" ("organization_id","replica_id","client_sequence");--> statement-breakpoint
CREATE INDEX "download_leases_organization_id_horizon_idx" ON "download_leases" ("organization_id","pinned_horizon");--> statement-breakpoint
CREATE INDEX "inventory_transactions_organization_epoch_commit_idx" ON "inventory_transactions" ("organization_id","epoch","commit_sequence");--> statement-breakpoint
CREATE INDEX "inventory_transactions_organization_operation_idx" ON "inventory_transactions" ("organization_id","operation_id");--> statement-breakpoint
CREATE INDEX "snapshot_jobs_organization_id_stage_idx" ON "snapshot_jobs" ("organization_id","stage");--> statement-breakpoint
ALTER TABLE "command_receipts" ADD CONSTRAINT "command_receipts_replica_fk" FOREIGN KEY ("organization_id","replica_id") REFERENCES "replicas"("organization_id","replica_id");--> statement-breakpoint
ALTER TABLE "command_receipts" ADD CONSTRAINT "command_receipts_transaction_fk" FOREIGN KEY ("organization_id","commit_sequence") REFERENCES "inventory_transactions"("organization_id","commit_sequence");--> statement-breakpoint
ALTER TABLE "download_leases" ADD CONSTRAINT "download_leases_snapshot_fk" FOREIGN KEY ("organization_id","snapshot_id") REFERENCES "snapshot_jobs"("organization_id","snapshot_id");--> statement-breakpoint
ALTER TABLE "inventory_changes" ADD CONSTRAINT "inventory_changes_transaction_fk" FOREIGN KEY ("organization_id","commit_sequence") REFERENCES "inventory_transactions"("organization_id","commit_sequence");