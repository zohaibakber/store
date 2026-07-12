import type {
  Batch,
  Category,
  CreateBatchInput,
  CreateInvoiceInput,
  CreateProductInput,
  Invoice,
  Product,
  StockMovement,
  SyncStatus,
  UpdateProductInput,
} from "@store/contracts";
import { relations } from "@store/db/relations";
import {
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "@store/db/schema";
import { and, eq, isNull, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/tursodatabase-sync";
import { migrate } from "drizzle-orm/tursodatabase-sync/migrator";
import type { DatabaseOpts } from "@tursodatabase/sync";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

export interface PersistenceConfig {
  readonly path: string;
  readonly migrationsFolder: string;
  readonly syncUrl?: string;
  readonly authToken?: string;
}

export class PersistenceError extends Schema.TaggedErrorClass<PersistenceError>()(
  "PersistenceError",
  { operation: Schema.String, message: Schema.String },
) {}

export class ProductNotFoundError extends Schema.TaggedErrorClass<ProductNotFoundError>()(
  "ProductNotFoundError",
  { id: Schema.String },
) {}

export class InvoiceNotFoundError extends Schema.TaggedErrorClass<InvoiceNotFoundError>()(
  "InvoiceNotFoundError",
  { id: Schema.String },
) {}

type StoreError = PersistenceError | ProductNotFoundError | InvoiceNotFoundError;

export class OfflineStore extends Context.Service<
  OfflineStore,
  {
    readonly listCategories: Effect.Effect<ReadonlyArray<Category>, PersistenceError>;
    readonly listProducts: Effect.Effect<ReadonlyArray<Product>, PersistenceError>;
    readonly getProduct: (id: string) => Effect.Effect<Product, StoreError>;
    readonly createProduct: (input: CreateProductInput) => Effect.Effect<Product, PersistenceError>;
    readonly updateProduct: (input: UpdateProductInput) => Effect.Effect<Product, StoreError>;
    readonly deleteProduct: (id: string) => Effect.Effect<void, StoreError>;
    readonly createBatch: (input: CreateBatchInput) => Effect.Effect<Batch, StoreError>;
    readonly listStockMovements: (
      productId: string,
    ) => Effect.Effect<ReadonlyArray<StockMovement>, PersistenceError>;
    readonly listInvoices: Effect.Effect<ReadonlyArray<Invoice>, PersistenceError>;
    readonly getInvoice: (id: string) => Effect.Effect<Invoice, StoreError>;
    readonly createInvoice: (input: CreateInvoiceInput) => Effect.Effect<Invoice, PersistenceError>;
    readonly getSyncStatus: Effect.Effect<SyncStatus>;
    readonly sync: Effect.Effect<SyncStatus, PersistenceError>;
  }
>()("@store/persistence/OfflineStore") {}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const attempt = <A>(operation: string, evaluate: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: () => Promise.resolve(evaluate()),
    catch: (cause) => new PersistenceError({ operation, message: messageOf(cause) }),
  });

type ProductRow = typeof products.$inferSelect;
type CategoryRow = typeof categories.$inferSelect;
type BatchRow = typeof batches.$inferSelect;
type InvoiceRow = typeof invoices.$inferSelect;
type InvoiceItemRow = typeof invoiceItems.$inferSelect;
type StockMovementRow = typeof stockMovements.$inferSelect;
type ProductWithRelations = ProductRow & { category: CategoryRow; batches: BatchRow[] };
type InvoiceWithItems = InvoiceRow & { items: InvoiceItemRow[] };

const toCategory = ({ deletedAt: _deletedAt, ...category }: CategoryRow): Category => category;

const toBatch = ({ deletedAt: _deletedAt, ...batch }: BatchRow): Batch => batch;

const toProduct = ({
  deletedAt: _deletedAt,
  category,
  batches: batchRows,
  ...product
}: ProductWithRelations): Product => ({
  ...product,
  category: toCategory(category),
  batches: batchRows.map(toBatch),
});

const toInvoice = ({ deletedAt: _deletedAt, items, ...invoice }: InvoiceWithItems): Invoice => ({
  ...invoice,
  items: items.map(({ deletedAt: _itemDeletedAt, ...item }) => item),
});

const toStockMovement = (movement: StockMovementRow): StockMovement => movement;

// Batches without an expiry date are drawn from last.
const byEarliestExpiry = (a: BatchRow, b: BatchRow) =>
  (a.expiresAt ?? Number.POSITIVE_INFINITY) - (b.expiresAt ?? Number.POSITIVE_INFINITY) ||
  a.createdAt - b.createdAt;

const make = (config: PersistenceConfig) =>
  Effect.gen(function* () {
    const configured = Boolean(config.syncUrl);
    let syncEnabled = false;
    const connection: DatabaseOpts = configured
      ? {
          path: config.path,
          url: () => (syncEnabled ? config.syncUrl! : null),
          ...(config.authToken ? { authToken: config.authToken } : {}),
          clientName: "store-electron",
        }
      : { path: config.path };
    const db = drizzle({
      connection,
      relations,
    });

    yield* attempt("connect database", () => db.$client.connect());
    yield* attempt("migrate database", () =>
      migrate(db, { migrationsFolder: config.migrationsFolder }),
    );

    const status = yield* Ref.make<SyncStatus>({
      phase: configured ? "idle" : "local-only",
      configured,
      lastSyncedAt: null,
      message: configured ? "Ready to sync" : "Add Turso credentials to enable cloud sync",
    });

    yield* Effect.addFinalizer(() =>
      attempt("close database", () => db.$client.close()).pipe(Effect.orDie),
    );

    const listCategories = attempt("list categories", () =>
      db.query.categories.findMany({
        orderBy: { name: "asc" },
        where: { deletedAt: { isNull: true } },
      }),
    ).pipe(Effect.map((rows) => rows.map(toCategory)));

    const withProductRelations = {
      category: true,
      batches: {
        where: { deletedAt: { isNull: true } },
        orderBy: { expiresAt: "asc", createdAt: "asc" },
      },
    } as const;

    const findProduct = (id: string) =>
      db.query.products.findFirst({
        where: { id, deletedAt: { isNull: true } },
        with: withProductRelations,
      });

    const listProducts = attempt("list products", () =>
      db.query.products.findMany({
        orderBy: { name: "asc" },
        where: { deletedAt: { isNull: true } },
        with: withProductRelations,
      }),
    ).pipe(Effect.map((rows) => rows.map(toProduct)));

    const getProduct = Effect.fn("OfflineStore.getProduct")(function* (id: string) {
      const row = yield* attempt("find product", () => findProduct(id));
      if (!row) return yield* new ProductNotFoundError({ id });
      return toProduct(row);
    });

    const createProduct = Effect.fn("OfflineStore.createProduct")(function* (
      input: CreateProductInput,
    ) {
      const now = Date.now();
      const row = yield* attempt("create product", async () => {
        const id = crypto.randomUUID();
        await db
          .insert(products)
          .values({
            ...input,
            id,
            name: input.name.trim(),
            createdAt: now,
            updatedAt: now,
          })
          .run();
        const created = await findProduct(id);
        if (!created) throw new Error("Created product could not be loaded");
        return created;
      });
      return toProduct(row);
    });

    const updateProduct = Effect.fn("OfflineStore.updateProduct")(function* (
      input: UpdateProductInput,
    ) {
      const { id, ...changes } = input;
      const row = yield* attempt("update product", async () => {
        const updated = await db
          .update(products)
          .set({ ...changes, name: changes.name.trim(), updatedAt: Date.now() })
          .where(and(eq(products.id, id), isNull(products.deletedAt)))
          .returning({ id: products.id })
          .get();
        if (!updated) return undefined;
        return findProduct(id);
      });
      if (!row) return yield* new ProductNotFoundError({ id });
      return toProduct(row);
    });

    const deleteProduct = Effect.fn("OfflineStore.deleteProduct")(function* (id: string) {
      const row = yield* attempt("delete product", () =>
        db
          .update(products)
          .set({ deletedAt: Date.now(), updatedAt: Date.now() })
          .where(and(eq(products.id, id), isNull(products.deletedAt)))
          .returning({ id: products.id })
          .get(),
      );
      if (!row) return yield* new ProductNotFoundError({ id });
    });

    const createBatch = Effect.fn("OfflineStore.createBatch")(function* (input: CreateBatchInput) {
      const packQuantity = input.packQuantity ?? 0;
      const unitQuantity = input.unitQuantity ?? 0;
      if (
        !Number.isInteger(packQuantity) ||
        !Number.isInteger(unitQuantity) ||
        packQuantity < 0 ||
        unitQuantity < 0 ||
        packQuantity + unitQuantity < 1
      )
        return yield* new PersistenceError({
          operation: "create batch",
          message: "Pack and unit quantities must be non-negative whole numbers with some stock",
        });
      const productRow = yield* attempt("find product", () => findProduct(input.productId));
      if (!productRow) return yield* new ProductNotFoundError({ id: input.productId });
      const now = Date.now();
      const row = yield* attempt("create batch", async () => {
        const id = crypto.randomUUID();
        return db.transaction(async (tx) => {
          await tx
            .insert(batches)
            .values({ ...input, id, packQuantity, unitQuantity, createdAt: now, updatedAt: now })
            .run();
          await tx
            .insert(stockMovements)
            .values({
              id: crypto.randomUUID(),
              productId: input.productId,
              batchId: id,
              invoiceId: null,
              type: "stock_in",
              packDelta: packQuantity,
              unitDelta: unitQuantity,
              note: "Initial batch stock",
              createdAt: now,
            })
            .run();
          const created = await tx.query.batches.findFirst({ where: { id } });
          if (!created) throw new Error("Created batch could not be loaded");
          return created;
        });
      });
      return toBatch(row);
    });

    const listStockMovements = (productId: string) =>
      attempt("list stock movements", () =>
        db.query.stockMovements.findMany({
          orderBy: { createdAt: "desc" },
          where: { productId },
        }),
      ).pipe(Effect.map((rows) => rows.map(toStockMovement)));

    const listInvoices = attempt("list invoices", () =>
      db.query.invoices.findMany({
        orderBy: { createdAt: "desc" },
        where: { deletedAt: { isNull: true } },
        with: { items: true },
      }),
    ).pipe(Effect.map((rows) => rows.map(toInvoice)));

    const getInvoice = Effect.fn("OfflineStore.getInvoice")(function* (id: string) {
      const row = yield* attempt("find invoice", () =>
        db.query.invoices.findFirst({
          where: { id, deletedAt: { isNull: true } },
          with: { items: true },
        }),
      );
      if (!row) return yield* new InvoiceNotFoundError({ id });
      return toInvoice(row);
    });

    // The whole sale runs in one transaction: stock is checked, drawn from
    // batches (chosen one first, then earliest expiry), and the invoice is
    // written — or nothing happens at all.
    const createInvoice = Effect.fn("OfflineStore.createInvoice")(function* (
      input: CreateInvoiceInput,
    ) {
      const invalid = (message: string) =>
        new PersistenceError({ operation: "create invoice", message });
      if (input.items.length === 0) return yield* invalid("Add at least one item to the sale");
      for (const line of input.items) {
        if (!Number.isInteger(line.quantity) || line.quantity < 1)
          return yield* invalid("Quantities must be whole numbers of 1 or more");
        if (!Number.isInteger(line.salePrice) || line.salePrice < 0)
          return yield* invalid("Sale prices cannot be negative");
      }
      const now = Date.now();
      const row = yield* attempt("create invoice", () =>
        db.transaction(async (tx) => {
          const allocations: Array<{
            productId: string;
            productName: string;
            batchId: string;
            batchNumber: string | null;
            quantity: number;
            quantityType: "unit" | "pack";
            baseUnitQuantity: number;
            salePrice: number;
          }> = [];
          const latest = await tx
            .select({ value: max(invoices.invoiceNumber) })
            .from(invoices)
            .get();
          const id = crypto.randomUUID();
          const total = input.items.reduce((sum, line) => sum + line.quantity * line.salePrice, 0);
          await tx
            .insert(invoices)
            .values({
              id,
              invoiceNumber: (latest?.value ?? 0) + 1,
              customerName: input.customerName?.trim() || null,
              total,
              createdAt: now,
              updatedAt: now,
            })
            .run();

          for (const line of input.items) {
            const product = await tx.query.products.findFirst({
              where: { id: line.productId, deletedAt: { isNull: true } },
            });
            if (!product) throw new Error("One of the products no longer exists");
            const productBatches = await tx.query.batches.findMany({
              where: { productId: line.productId, deletedAt: { isNull: true } },
            });
            const open = line.batchId
              ? productBatches.filter((batch) => batch.id === line.batchId)
              : productBatches
                  .sort(byEarliestExpiry)
                  .filter((batch) =>
                    line.quantityType === "pack"
                      ? batch.packQuantity > 0
                      : batch.packQuantity * product.unitsPerPack + batch.unitQuantity > 0,
                  );
            if (line.batchId && open.length === 0)
              throw new Error(`The selected batch for ${product.name} no longer exists`);
            const available = open.reduce(
              (sum, batch) =>
                sum +
                (line.quantityType === "pack"
                  ? batch.packQuantity
                  : batch.packQuantity * product.unitsPerPack + batch.unitQuantity),
              0,
            );
            if (available < line.quantity)
              throw new Error(
                `Not enough stock for ${product.name}: ${available} in stock, ${line.quantity} requested`,
              );
            let remaining = line.quantity;
            for (const batch of open) {
              if (remaining === 0) break;
              const batchAvailable =
                line.quantityType === "pack"
                  ? batch.packQuantity
                  : batch.packQuantity * product.unitsPerPack + batch.unitQuantity;
              const taken = Math.min(batchAvailable, remaining);
              remaining -= taken;
              allocations.push({
                productId: product.id,
                productName: product.name,
                batchId: batch.id,
                batchNumber: batch.batchNumber,
                quantity: taken,
                quantityType: line.quantityType,
                baseUnitQuantity: taken * (line.quantityType === "pack" ? product.unitsPerPack : 1),
                salePrice: line.salePrice,
              });
              if (line.quantityType === "pack") {
                await tx
                  .update(batches)
                  .set({ packQuantity: batch.packQuantity - taken, updatedAt: now })
                  .where(eq(batches.id, batch.id))
                  .run();
                await tx
                  .insert(stockMovements)
                  .values({
                    id: crypto.randomUUID(),
                    productId: product.id,
                    batchId: batch.id,
                    invoiceId: id,
                    type: "sale",
                    packDelta: -taken,
                    unitDelta: 0,
                    note: `Invoice #${(latest?.value ?? 0) + 1}`,
                    createdAt: now,
                  })
                  .run();
              } else {
                const packsOpened = Math.max(
                  0,
                  Math.ceil((taken - batch.unitQuantity) / product.unitsPerPack),
                );
                const looseUnits = batch.unitQuantity + packsOpened * product.unitsPerPack;
                await tx
                  .update(batches)
                  .set({
                    packQuantity: batch.packQuantity - packsOpened,
                    unitQuantity: looseUnits - taken,
                    updatedAt: now,
                  })
                  .where(eq(batches.id, batch.id))
                  .run();
                if (packsOpened > 0) {
                  await tx
                    .insert(stockMovements)
                    .values({
                      id: crypto.randomUUID(),
                      productId: product.id,
                      batchId: batch.id,
                      invoiceId: id,
                      type: "open_pack",
                      packDelta: -packsOpened,
                      unitDelta: packsOpened * product.unitsPerPack,
                      note: `Opened for invoice #${(latest?.value ?? 0) + 1}`,
                      createdAt: now,
                    })
                    .run();
                }
                await tx
                  .insert(stockMovements)
                  .values({
                    id: crypto.randomUUID(),
                    productId: product.id,
                    batchId: batch.id,
                    invoiceId: id,
                    type: "sale",
                    packDelta: 0,
                    unitDelta: -taken,
                    note: `Invoice #${(latest?.value ?? 0) + 1}`,
                    createdAt: now,
                  })
                  .run();
              }
            }
          }
          for (const allocation of allocations) {
            await tx
              .insert(invoiceItems)
              .values({
                ...allocation,
                id: crypto.randomUUID(),
                invoiceId: id,
                createdAt: now,
                updatedAt: now,
              })
              .run();
          }
          const created = await tx.query.invoices.findFirst({
            where: { id },
            with: { items: true },
          });
          if (!created) throw new Error("Created invoice could not be loaded");
          return created;
        }),
      );
      return toInvoice(row);
    });

    const sync = Effect.fn("OfflineStore.sync")(function* () {
      if (!configured) return yield* Ref.get(status);
      yield* Ref.update(status, (current) => ({
        ...current,
        phase: "syncing" as const,
        message: "Pushing local changes…",
      }));
      syncEnabled = true;
      const result = yield* attempt("sync with Turso", async () => {
        await db.$client.push();
        await db.$client.pull();
      }).pipe(Effect.result);
      if (result._tag === "Failure") {
        yield* Ref.update(status, (current) => ({
          ...current,
          phase: "error" as const,
          message: result.failure.message,
        }));
        return yield* result.failure;
      }
      const next: SyncStatus = {
        phase: "idle",
        configured: true,
        lastSyncedAt: Date.now(),
        message: "Local and cloud data are in sync",
      };
      yield* Ref.set(status, next);
      return next;
    });

    return OfflineStore.of({
      listCategories,
      listProducts,
      getProduct,
      createProduct,
      updateProduct,
      deleteProduct,
      createBatch,
      listStockMovements,
      listInvoices,
      getInvoice,
      createInvoice,
      getSyncStatus: Ref.get(status),
      sync: sync(),
    });
  });

export const layer = (config: PersistenceConfig) => Layer.effect(OfflineStore, make(config));

export const program = {
  listCategories: Effect.flatMap(OfflineStore, (store) => store.listCategories),
  listProducts: Effect.flatMap(OfflineStore, (store) => store.listProducts),
  getProduct: (id: string) => Effect.flatMap(OfflineStore, (store) => store.getProduct(id)),
  createProduct: (input: CreateProductInput) =>
    Effect.flatMap(OfflineStore, (store) => store.createProduct(input)),
  updateProduct: (input: UpdateProductInput) =>
    Effect.flatMap(OfflineStore, (store) => store.updateProduct(input)),
  deleteProduct: (id: string) => Effect.flatMap(OfflineStore, (store) => store.deleteProduct(id)),
  createBatch: (input: CreateBatchInput) =>
    Effect.flatMap(OfflineStore, (store) => store.createBatch(input)),
  listStockMovements: (productId: string) =>
    Effect.flatMap(OfflineStore, (store) => store.listStockMovements(productId)),
  listInvoices: Effect.flatMap(OfflineStore, (store) => store.listInvoices),
  getInvoice: (id: string) => Effect.flatMap(OfflineStore, (store) => store.getInvoice(id)),
  createInvoice: (input: CreateInvoiceInput) =>
    Effect.flatMap(OfflineStore, (store) => store.createInvoice(input)),
  getSyncStatus: Effect.flatMap(OfflineStore, (store) => store.getSyncStatus),
  sync: Effect.flatMap(OfflineStore, (store) => store.sync),
} as const;
