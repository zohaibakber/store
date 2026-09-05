CREATE TABLE "catalog_notification_outbox" (
	"organization_id" text PRIMARY KEY,
	"cursor" bigint NOT NULL
);
