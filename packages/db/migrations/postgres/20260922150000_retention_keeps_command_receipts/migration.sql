ALTER TABLE "command_receipts" DROP CONSTRAINT IF EXISTS "command_receipts_transaction_fk";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshot_jobs_organization_id_step_due_at_idx" ON "snapshot_jobs" ("organization_id","step_due_at");
