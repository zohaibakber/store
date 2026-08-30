ALTER TABLE "products" RENAME COLUMN "pack_price" TO "retail_price";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "purchase_price" integer;
