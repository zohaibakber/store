DROP TABLE "live_sessions";--> statement-breakpoint
ALTER TABLE "inventory_state" ADD COLUMN "maintained_at" bigint;--> statement-breakpoint
CREATE INDEX "inventory_state_maintained_at_organization_id_idx" ON "inventory_state" ("maintained_at","organization_id");