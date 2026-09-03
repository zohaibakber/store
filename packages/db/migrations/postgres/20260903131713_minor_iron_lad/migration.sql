CREATE TABLE "catalog_change_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "catalog_change_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" text NOT NULL,
	"entity" text NOT NULL,
	"action" text NOT NULL,
	"entity_id" text NOT NULL,
	"row_version" bigint NOT NULL,
	"row" jsonb,
	"recorded_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "catalog_change_log_organization_id_id_idx" ON "catalog_change_log" ("organization_id","id");--> statement-breakpoint
CREATE INDEX "catalog_change_log_organization_entity_idx" ON "catalog_change_log" ("organization_id","entity","entity_id");