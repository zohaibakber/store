CREATE TABLE "snapshot_staged_rows" (
	"organization_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"row_version" integer NOT NULL,
	"row_json" text NOT NULL,
	CONSTRAINT "snapshot_staged_rows_pk" PRIMARY KEY("organization_id","snapshot_id","entity","entity_id"),
	CONSTRAINT "snapshot_staged_rows_row_version_positive" CHECK ("row_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "snapshot_parts" (
	"organization_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"part_number" integer NOT NULL,
	"object_key" text NOT NULL,
	"byte_length" integer NOT NULL,
	"sha256" text NOT NULL,
	"payload_json" text NOT NULL,
	CONSTRAINT "snapshot_parts_pk" PRIMARY KEY("organization_id","snapshot_id","part_number"),
	CONSTRAINT "snapshot_parts_part_number_positive" CHECK ("part_number" > 0),
	CONSTRAINT "snapshot_parts_byte_length_nonnegative" CHECK ("byte_length" >= 0)
);
--> statement-breakpoint
CREATE TABLE "live_sessions" (
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"replica_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"subscription" text NOT NULL,
	"delivered_through_commit_sequence" numeric(20, 0) NOT NULL,
	"lease_expires_at" bigint NOT NULL,
	CONSTRAINT "live_sessions_organization_id_session_id_pk" PRIMARY KEY("organization_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "consumed_tickets" (
	"organization_id" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"expires_at" bigint NOT NULL,
	CONSTRAINT "consumed_tickets_organization_id_nonce_hash_pk" PRIMARY KEY("organization_id","nonce_hash")
);
--> statement-breakpoint
ALTER TABLE "snapshot_staged_rows" ADD CONSTRAINT "snapshot_staged_rows_job_fk" FOREIGN KEY ("organization_id","snapshot_id") REFERENCES "snapshot_jobs"("organization_id","snapshot_id");--> statement-breakpoint
ALTER TABLE "snapshot_parts" ADD CONSTRAINT "snapshot_parts_job_fk" FOREIGN KEY ("organization_id","snapshot_id") REFERENCES "snapshot_jobs"("organization_id","snapshot_id");--> statement-breakpoint
CREATE INDEX "live_sessions_organization_id_replica_id_idx" ON "live_sessions" ("organization_id","replica_id");--> statement-breakpoint
CREATE INDEX "live_sessions_organization_id_lease_idx" ON "live_sessions" ("organization_id","lease_expires_at");--> statement-breakpoint
CREATE INDEX "consumed_tickets_organization_id_expires_at_idx" ON "consumed_tickets" ("organization_id","expires_at");
