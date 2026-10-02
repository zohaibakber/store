import type {
  CreateBatchInput,
  CreateCategoryInput,
  CreateInvoiceInput,
  CreateProductInput,
  ImportInventoryCommandResult,
  ImportInventoryInput,
  InvoiceId,
  IssueInvoiceResult,
  SyncCommandEnvelope,
  UpdateBatchInput,
  UpdateCategoryInput,
  UpdateProductInput,
} from "@store/contracts";
import { MAX_CATALOG_WRITE_ROWS, type CatalogRowWrite } from "@store/contracts/catalog-write";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import {
  projectCreateBatch,
  projectCreateCategory,
  projectCreateProduct,
  projectDeleteCategory,
  projectDeleteProduct,
  projectImportInventory,
  projectUpdateBatch,
  projectUpdateCategory,
  projectUpdateProduct,
  type CatalogProjectionContext,
} from "./catalog-projection";
import {
  readCatalogRows,
  readNextInvoiceNumber,
  readNextPurchaseOrderNumber,
  readPurchasingRows,
  type CatalogRowsRequest,
  type PurchasingRowsRequest,
} from "./catalog-read";
import { projectIssuedInvoice } from "./invoice-projection";
import type { CatalogActor, ProjectionContext } from "./projection-context";
import {
  projectCancelOrder,
  projectCloseOrder,
  projectDeleteSupplier,
  projectReceiveDelivery,
  projectSaveOrderDraft,
  projectSaveSupplier,
  projectSendOrder,
  type PurchasingProjectionContext,
  type ReceivedDelivery,
  type ReceiveDeliveryInput,
  type SavedPurchaseOrder,
  type SaveOrderDraftInput,
  type SaveSupplierInput,
} from "./purchasing-projection";
import type { ReplicaHandle, ReplicaSubsetReader } from "./replica/types";
import type { BatchRow, CategoryRow, ProductRow, PurchaseOrderRow, SupplierRow } from "./rows";

export type CommandExecution =
  | { readonly _tag: "accepting"; readonly operationId: string }
  | { readonly _tag: "pending"; readonly operationId: string; readonly status: string }
  | { readonly _tag: "failed"; readonly operationId: string; readonly message: string };

type CreateProductWithBatchInput = {
  readonly product: CreateProductInput;
  readonly batch: Omit<CreateBatchInput, "productId">;
};

type CreatedProductWithBatch = {
  readonly product: ProductRow;
  readonly batch: BatchRow;
};

type ImportIntoNewCategoryInput = {
  readonly newCategory: CreateCategoryInput;
  readonly lines: ImportInventoryInput["lines"];
};

export type ImportInventoryRequest = ImportInventoryInput | ImportIntoNewCategoryInput;

export interface CatalogCommands {
  readonly createCategory: (input: CreateCategoryInput) => Promise<CategoryRow>;
  readonly updateCategory: (input: UpdateCategoryInput) => Promise<CategoryRow>;
  readonly deleteCategory: (id: UpdateCategoryInput["id"]) => Promise<void>;
  readonly createProduct: (input: CreateProductInput) => Promise<ProductRow>;
  readonly createProductWithBatch: (
    input: CreateProductWithBatchInput,
  ) => Promise<CreatedProductWithBatch>;
  readonly updateProduct: (input: UpdateProductInput) => Promise<ProductRow>;
  readonly deleteProduct: (id: UpdateProductInput["id"]) => Promise<void>;
  readonly createBatch: (input: CreateBatchInput) => Promise<BatchRow>;
  readonly receiveBatch: (input: CreateBatchInput) => Promise<BatchRow>;
  readonly updateBatch: (input: UpdateBatchInput) => Promise<BatchRow>;
  readonly importInventory: (
    input: ImportInventoryRequest,
  ) => Promise<ImportInventoryCommandResult>;
  readonly issueInvoice: (
    input: CreateInvoiceInput,
    invoiceId?: InvoiceId,
  ) => Promise<IssueInvoiceResult>;
  readonly saveSupplier: (input: SaveSupplierInput) => Promise<SupplierRow>;
  readonly deleteSupplier: (id: string) => Promise<void>;
  readonly saveOrderDraft: (input: SaveOrderDraftInput) => Promise<SavedPurchaseOrder>;
  readonly sendOrder: (id: string) => Promise<PurchaseOrderRow>;
  readonly closeOrder: (id: string) => Promise<PurchaseOrderRow>;
  readonly cancelOrder: (id: string) => Promise<PurchaseOrderRow>;
  readonly receiveDelivery: (input: ReceiveDeliveryInput) => Promise<ReceivedDelivery>;
}

type CatalogCommandsInput = {
  readonly actor: CatalogActor;
  readonly replica: ReplicaSubsetReader &
    Pick<ReplicaHandle, "enqueueCommand" | "readCommandStatus">;
  readonly onExecution: (execution: CommandExecution) => void;
  readonly wakeSyncUpload: () => void;
};

type RowState<Row> = {
  readonly get: (id: string) => Row | undefined;
  readonly values: () => Iterable<Row>;
};

type Projected<Row> = {
  readonly writes: ReadonlyArray<CatalogRowWrite>;
  readonly row: Row;
};

const withRow = <Row extends { readonly id: string }>(state: RowState<Row>, row: Row) => ({
  state: {
    get: (id: string) => (id === row.id ? row : state.get(id)),
    values: function* () {
      yield row;
      yield* state.values();
    },
  },
});

const withProjectedProduct = (
  context: CatalogProjectionContext,
  product: ProductRow,
): CatalogProjectionContext => ({
  ...context,
  tables: { ...context.tables, products: withRow(context.tables.products.state, product) },
});

const withProjectedCategory = (
  context: CatalogProjectionContext,
  category: CategoryRow,
): CatalogProjectionContext => ({
  ...context,
  tables: { ...context.tables, categories: withRow(context.tables.categories.state, category) },
});

const leadingChunks = (
  leading: ReadonlyArray<CatalogRowWrite>,
  chunks: ReadonlyArray<ReadonlyArray<CatalogRowWrite>>,
): ReadonlyArray<ReadonlyArray<CatalogRowWrite>> => {
  if (leading.length === 0) return chunks;
  const [first = [], ...rest] = chunks;
  return leading.length + first.length <= MAX_CATALOG_WRITE_ROWS
    ? [[...leading, ...first], ...rest]
    : [leading, ...chunks];
};

const importCategory = (context: CatalogProjectionContext, input: CreateCategoryInput) => {
  const projected = projectCreateCategory(context, input);
  return {
    writes: projected.writes,
    id: projected.row.id,
    tables: withProjectedCategory(context, projected.row).tables,
  };
};

const removed = (projection: {
  readonly writes: ReadonlyArray<CatalogRowWrite>;
}): Projected<void> => ({ writes: projection.writes, row: undefined });

const CATEGORY_NOT_SAVED = "The category could not be saved locally.";
const PRODUCT_NOT_SAVED = "The product could not be saved locally.";
const BATCH_NOT_SAVED = "The batch could not be saved locally.";
const ORDER_NOT_SAVED = "The purchase order could not be saved locally.";

const failureMessage = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

const attempt = <A>(evaluate: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: evaluate, catch: (cause) => cause });

const projecting = <A>(project: () => A): Effect.Effect<A, unknown> =>
  Effect.try({ try: project, catch: (cause) => cause });

export const makeCatalogCommands = ({
  actor,
  replica,
  onExecution,
  wakeSyncUpload,
}: CatalogCommandsInput): CatalogCommands => {
  const enqueue = Effect.fn("CatalogCommands.enqueue")(function* (
    operationId: string,
    command: SyncCommandEnvelope["command"],
    occurredAt: number,
    callerChoseId = false,
  ) {
    const request = { operationId, command, occurredAt };
    const save = attempt(() => replica.enqueueCommand(request));
    const saved = callerChoseId
      ? Effect.succeed(false)
      : attempt(() => replica.readCommandStatus(operationId)).pipe(
          Effect.map((status) => status !== undefined),
          Effect.orElseSucceed(() => false),
        );
    yield* save.pipe(
      Effect.catch((cause) =>
        Effect.flatMap(saved, (durable) =>
          durable ? Effect.void : Effect.mapError(save, () => cause),
        ),
      ),
    );
  });

  const runProjected = <Tables, Result>(
    fallbackMessage: string,
    read: Effect.Effect<Tables, unknown>,
    run: (context: ProjectionContext<Tables>) => Effect.Effect<Result, unknown>,
    commandId: string = crypto.randomUUID(),
  ): Promise<Result> => {
    const accepted = Effect.gen(function* () {
      const tables = yield* read;
      const occurredAt = yield* Clock.currentTimeMillis;
      const result = yield* run({
        actor,
        commandId,
        occurredAt,
        ids: {
          now: () => occurredAt,
          operationId: () => commandId,
          rowId: () => crypto.randomUUID(),
        },
        tables,
      });
      onExecution({ _tag: "pending", operationId: commandId, status: "queued" });
      wakeSyncUpload();
      return result;
    }).pipe(
      Effect.tapCause((cause) =>
        Effect.sync(() =>
          onExecution({
            _tag: "failed",
            operationId: commandId,
            message: failureMessage(Cause.squash(cause), fallbackMessage),
          }),
        ),
      ),
    );
    return Effect.runPromise(
      Effect.andThen(
        Effect.sync(() => onExecution({ _tag: "accepting", operationId: commandId })),
        accepted,
      ),
    );
  };

  const catalogCommand = (
    context: ProjectionContext<unknown>,
    writes: ReadonlyArray<CatalogRowWrite>,
  ): Effect.Effect<void, unknown> =>
    writes.length === 0
      ? Effect.void
      : enqueue(
          context.commandId,
          {
            _tag: "catalogWrite",
            payload: {
              commandId: context.commandId,
              deviceId: context.actor.deviceId,
              occurredAt: context.occurredAt,
              writes,
            },
          },
          context.occurredAt,
        );

  const write = <Tables, Row>(
    fallbackMessage: string,
    read: Effect.Effect<Tables, unknown>,
    project: (context: ProjectionContext<Tables>) => Effect.Effect<Projected<Row>, unknown>,
  ): Promise<Row> =>
    runProjected(fallbackMessage, read, (context) =>
      Effect.flatMap(project(context), (projected) =>
        Effect.as(catalogCommand(context, projected.writes), projected.row),
      ),
    );

  const catalog = <Row>(
    fallbackMessage: string,
    rows: CatalogRowsRequest,
    project: (context: CatalogProjectionContext) => Projected<Row>,
  ) =>
    write(fallbackMessage, readCatalogRows(replica, rows), (context) =>
      projecting(() => project(context)),
    );

  const purchasing = <Row>(
    fallbackMessage: string,
    rows: PurchasingRowsRequest,
    project: (context: PurchasingProjectionContext) => Projected<Row>,
  ) =>
    write(fallbackMessage, readPurchasingRows(replica, rows), (context) =>
      projecting(() => project(context)),
    );

  const createBatch: CatalogCommands["createBatch"] = (input) =>
    catalog(BATCH_NOT_SAVED, { productIds: [input.productId] }, (context) =>
      projectCreateBatch(context, input),
    );

  return {
    createCategory: (input) =>
      catalog(CATEGORY_NOT_SAVED, { allCategories: true }, (context) =>
        projectCreateCategory(context, input),
      ),
    updateCategory: (input) =>
      catalog(CATEGORY_NOT_SAVED, { allCategories: true }, (context) =>
        projectUpdateCategory(context, input),
      ),
    deleteCategory: (id) =>
      catalog(
        "The category could not be removed locally.",
        { categoryIds: [id], anyProductInCategory: id },
        (context) => removed(projectDeleteCategory(context, id)),
      ),
    createProduct: (input) =>
      catalog(
        PRODUCT_NOT_SAVED,
        { categoryIds: input.categoryId ? [input.categoryId] : [] },
        (context) => projectCreateProduct(context, input),
      ),
    updateProduct: (input) =>
      catalog(
        PRODUCT_NOT_SAVED,
        { allCategories: true, productIds: [input.id], batchesOfProductIds: [input.id] },
        (context) => projectUpdateProduct(context, input),
      ),
    deleteProduct: (id) =>
      catalog(
        "The product could not be removed locally.",
        { productIds: [id], batchesOfProductIds: [id] },
        (context) => removed(projectDeleteProduct(context, id)),
      ),
    createProductWithBatch: (input) =>
      catalog(
        PRODUCT_NOT_SAVED,
        { categoryIds: input.product.categoryId ? [input.product.categoryId] : [] },
        (context) => {
          const product = projectCreateProduct(context, input.product);
          const batch = projectCreateBatch(withProjectedProduct(context, product.row), {
            ...input.batch,
            productId: product.row.id,
          });
          return {
            writes: [...product.writes, ...batch.writes],
            row: { product: product.row, batch: batch.row },
          };
        },
      ),
    createBatch,
    receiveBatch: createBatch,
    updateBatch: (input) =>
      catalog(BATCH_NOT_SAVED, { batchIds: [input.id] }, (context) =>
        projectUpdateBatch(context, input),
      ),
    importInventory: (input) => {
      const productIds = input.lines.flatMap((line) => (line.productId ? [line.productId] : []));
      const rows: CatalogRowsRequest =
        "categoryId" in input
          ? { categoryIds: [input.categoryId], productIds }
          : { allCategories: true, productIds };
      return runProjected(
        "The import could not be saved locally.",
        readCatalogRows(replica, rows),
        Effect.fnUntraced(function* (context) {
          const projected = yield* projecting(() => {
            const category =
              "categoryId" in input
                ? { writes: [], id: input.categoryId, tables: context.tables }
                : importCategory(context, input.newCategory);
            const imported = projectImportInventory(
              { ids: context.ids, tables: category.tables },
              { categoryId: category.id, lines: input.lines },
            );
            return { ...imported, chunks: leadingChunks(category.writes, imported.chunks) };
          });
          yield* Effect.forEach(
            projected.chunks,
            (chunk, index) =>
              catalogCommand(
                { ...context, commandId: index === 0 ? context.commandId : crypto.randomUUID() },
                chunk,
              ),
            { discard: true },
          );
          return {
            createdProducts: projected.createdProducts,
            createdBatches: projected.createdBatches,
            txid: context.occurredAt,
          };
        }),
      );
    },
    issueInvoice: (input, invoiceId) => {
      const productIds = input.items.map((line) => line.productId);
      return runProjected(
        "Invoice could not be accepted locally.",
        readCatalogRows(replica, { productIds, batchesOfProductIds: productIds }),
        Effect.fnUntraced(function* (context) {
          const invoiceNumber = yield* readNextInvoiceNumber(replica, context.actor.organizationId);
          const projection = yield* projecting(() =>
            projectIssuedInvoice({
              actor: context.actor,
              commandId: context.commandId,
              occurredAt: context.occurredAt,
              invoiceNumber,
              sale: input,
              products: context.tables.products,
              batches: context.tables.batches,
              ids: context.ids,
            }),
          );
          yield* enqueue(
            context.commandId,
            { _tag: "issueInvoice", payload: projection.command },
            context.occurredAt,
            invoiceId !== undefined,
          );
          return {
            invoiceId: projection.invoice.id,
            invoiceNumber: projection.invoice.invoiceNumber,
          };
        }),
        invoiceId,
      );
    },
    saveSupplier: (input) =>
      purchasing("The supplier could not be saved locally.", { allSuppliers: true }, (context) =>
        projectSaveSupplier(context, input),
      ),
    deleteSupplier: (id) =>
      purchasing(
        "The supplier could not be removed locally.",
        { supplierIds: [id], anyOrderOfSupplier: id },
        (context) => removed(projectDeleteSupplier(context, id)),
      ),
    saveOrderDraft: (input) => {
      const orderIds = input.id === undefined ? [] : [input.id];
      return write(
        ORDER_NOT_SAVED,
        readPurchasingRows(replica, {
          supplierIds: [input.supplierId],
          orderIds,
          itemsOfOrderIds: orderIds,
          productIds: input.lines.map((line) => line.productId),
        }),
        (context) =>
          Effect.flatMap(
            readNextPurchaseOrderNumber(replica, context.actor.organizationId),
            (orderNumber) => projecting(() => projectSaveOrderDraft(context, input, orderNumber)),
          ),
      );
    },
    sendOrder: (id) =>
      purchasing(ORDER_NOT_SAVED, { orderIds: [id], itemsOfOrderIds: [id] }, (context) =>
        projectSendOrder(context, id),
      ),
    closeOrder: (id) =>
      purchasing(ORDER_NOT_SAVED, { orderIds: [id] }, (context) => projectCloseOrder(context, id)),
    cancelOrder: (id) =>
      purchasing(ORDER_NOT_SAVED, { orderIds: [id] }, (context) => projectCancelOrder(context, id)),
    receiveDelivery: (input) =>
      purchasing(
        "The delivery could not be saved locally.",
        { orderIds: [input.orderId], itemsOfOrderIds: [input.orderId], productsOfItems: true },
        (context) => projectReceiveDelivery(context, input),
      ),
  };
};
