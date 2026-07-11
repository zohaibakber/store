import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const productCategories = ["medicine", "cosmetics", "general"] as const;

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category", { enum: productCategories }).notNull().default("general"),
  barcode: text("barcode"),
  composition: text("composition"),
  strength: text("strength"),
  unitsPerPack: integer("units_per_pack").notNull().default(1),
  costPrice: integer("cost_price"),
  packPrice: integer("pack_price"),
  unitPrice: integer("unit_price"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
});

export const batches = sqliteTable("batches", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  batchNumber: text("batch_number"),
  expiresAt: integer("expires_at"),
  quantity: integer("quantity").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
});
