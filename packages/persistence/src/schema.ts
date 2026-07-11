import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Any item sold in the shop — medicines, shampoos, soaps, etc.
// Medicine-specific fields (composition, strength) stay null for other categories.
// Prices are stored in the smallest currency unit (e.g. paisa) as integers.
export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull().default("general"),
  barcode: text("barcode"),
  composition: text("composition"),
  strength: text("strength"),
  // How many sellable items one pack contains (1 = sold as-is).
  unitsPerPack: integer("units_per_pack").notNull().default(1),
  costPrice: integer("cost_price"),
  packPrice: integer("pack_price"),
  unitPrice: integer("unit_price"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
});

// One stock lot of a product. Medicines get a real batch number + expiry;
// other products use a single row with those fields null.
// `quantity` is total items: packs = quantity / unitsPerPack, loose = remainder.
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

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
});
