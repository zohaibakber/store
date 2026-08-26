ALTER TABLE "electric_mutation_receipts" RENAME TO "inventory_mutation_receipts";--> statement-breakpoint
ALTER TABLE "inventory_mutation_receipts" RENAME CONSTRAINT "electric_mutation_receipts_organization_operation_pk" TO "inventory_mutation_receipts_organization_operation_pk";--> statement-breakpoint
DROP PUBLICATION IF EXISTS electric;--> statement-breakpoint
DROP PUBLICATION IF EXISTS electric_publication;--> statement-breakpoint
DROP SCHEMA IF EXISTS electric CASCADE;