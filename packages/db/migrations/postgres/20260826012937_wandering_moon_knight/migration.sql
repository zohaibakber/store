CREATE TABLE "legacy_catalog_migration_jobs" (
	"id" text,
	"organization_id" text,
	"request_id" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"status" text NOT NULL,
	"phase" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"total_rows" integer NOT NULL,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"skipped_rows" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"payload" text NOT NULL,
	"error" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"completed_at" bigint,
	CONSTRAINT "legacy_catalog_migration_jobs_organization_id_id_pk" PRIMARY KEY("organization_id","id"),
	CONSTRAINT "legacy_catalog_migration_jobs_progress_range" CHECK ("progress" >= 0 and "progress" <= 100),
	CONSTRAINT "legacy_catalog_migration_jobs_counts_nonnegative" CHECK ("processed_rows" >= 0 and "total_rows" >= 0 and "imported_rows" >= 0 and "skipped_rows" >= 0 and "attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_catalog_migration_jobs_organization_request_uidx" ON "legacy_catalog_migration_jobs" ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "legacy_catalog_migration_jobs_organization_status_idx" ON "legacy_catalog_migration_jobs" ("organization_id","status");