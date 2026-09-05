CREATE TABLE "catalog_bootstrap_rows" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "catalog_bootstrap_rows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"bootstrap_id" text NOT NULL,
	"change" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_bootstraps" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"cursor" bigint NOT NULL,
	"slices" text NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_change_log" ADD COLUMN "transaction_end" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "catalog_bootstrap_rows_page_idx" ON "catalog_bootstrap_rows" ("bootstrap_id","id");--> statement-breakpoint
CREATE INDEX "catalog_bootstraps_expiry_idx" ON "catalog_bootstraps" ("expires_at");--> statement-breakpoint
ALTER TABLE "catalog_bootstrap_rows" ADD CONSTRAINT "catalog_bootstrap_rows_bootstrap_id_catalog_bootstraps_id_fkey" FOREIGN KEY ("bootstrap_id") REFERENCES "catalog_bootstraps"("id") ON DELETE CASCADE;