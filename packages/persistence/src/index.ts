import type {
  Category,
  CreateProductInput,
  Product,
  SyncStatus,
  UpdateProductInput,
} from "@store/contracts";
import { relations } from "@store/database/relations";
import { categories, products } from "@store/database/schema";
import { and, eq, isNull } from "drizzle-orm";
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

type StoreError = PersistenceError | ProductNotFoundError;

export class OfflineStore extends Context.Service<
  OfflineStore,
  {
    readonly listCategories: Effect.Effect<ReadonlyArray<Category>, PersistenceError>;
    readonly listProducts: Effect.Effect<ReadonlyArray<Product>, PersistenceError>;
    readonly getProduct: (id: string) => Effect.Effect<Product, StoreError>;
    readonly createProduct: (input: CreateProductInput) => Effect.Effect<Product, PersistenceError>;
    readonly updateProduct: (input: UpdateProductInput) => Effect.Effect<Product, StoreError>;
    readonly deleteProduct: (id: string) => Effect.Effect<void, StoreError>;
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
type ProductWithCategory = ProductRow & { category: CategoryRow };

const toCategory = ({ deletedAt: _deletedAt, ...category }: CategoryRow): Category => category;

const toProduct = ({
  deletedAt: _deletedAt,
  category,
  ...product
}: ProductWithCategory): Product => ({
  ...product,
  category: toCategory(category),
});

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

    const findProduct = (id: string) =>
      db.query.products.findFirst({
        where: { id, deletedAt: { isNull: true } },
        with: { category: true },
      });

    const listProducts = attempt("list products", () =>
      db.query.products.findMany({
        orderBy: { name: "asc" },
        where: { deletedAt: { isNull: true } },
        with: { category: true },
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
  getSyncStatus: Effect.flatMap(OfflineStore, (store) => store.getSyncStatus),
  sync: Effect.flatMap(OfflineStore, (store) => store.sync),
} as const;
