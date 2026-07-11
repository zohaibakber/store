import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";

const timestamps = {
  createdAt: integer().notNull(),
  updatedAt: integer().notNull(),
  deletedAt: integer(),
};

const primaryId = text()
  .primaryKey()
  .$defaultFn(() => nanoid());

export const categories = sqliteTable(
  "categories",
  {
    id: primaryId,
    name: text().notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("categories_name_idx").on(table.name)],
);

export const products = sqliteTable(
  "products",
  {
    id: primaryId,
    name: text().notNull(),
    categoryId: text()
      .notNull()
      .default("general")
      .references(() => categories.id),
    barcode: text(),
    composition: text(),
    strength: text(),
    unitsPerPack: integer().notNull().default(1),
    costPrice: integer(),
    packPrice: integer(),
    unitPrice: integer(),
    ...timestamps,
  },
  (table) => [index("products_category_id_idx").on(table.categoryId)],
);

export const batches = sqliteTable("batches", {
  id: primaryId,
  productId: text()
    .notNull()
    .references(() => products.id),
  batchNumber: text(),
  expiresAt: integer(),
  quantity: integer().notNull().default(0),
  ...timestamps,
});
