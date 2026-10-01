import {
  projectCreateBatch,
  projectCreateCategory,
  projectCancelOrder,
  projectCloseOrder,
  projectCreateProduct,
  projectDeleteCategory,
  projectDeleteProduct,
  projectDeleteSupplier,
  projectImportInventory,
  projectIssuedInvoice,
  projectReceiveDelivery,
  projectSaveOrderDraft,
  projectSaveSupplier,
  projectSendOrder,
  projectUpdateBatch,
  projectUpdateCategory,
  projectUpdateProduct,
  readCatalogRows,
  readNextInvoiceNumber,
  readNextPurchaseOrderNumber,
  readPurchasingRows,
  type CatalogProjectionContext,
  type CatalogRowsRequest,
  type CategoryRow,
  type ProductRow,
  type ProjectionContext,
  type PurchasingProjectionContext,
  type PurchasingRowsRequest,
  type ReplicaHandle,
} from "@store/client-db";
import type { CreateCategoryInput, SyncCommandEnvelope } from "@store/contracts";
import { MAX_CATALOG_WRITE_ROWS, type CatalogRowWrite } from "@store/contracts/catalog-write";

import type { CommandExecutionState, WorkspaceAtoms } from "./atoms";
import type { InventoryActions, InventoryActor } from "./types";

type RowState<Row> = {
  readonly get: (id: string) => Row | undefined;
  readonly values: () => Iterable<Row>;
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

const ORDER_NOT_SAVED = "The purchase order could not be saved locally.";

const failureMessage = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

export const makeInventoryActions = (
  actor: InventoryActor,
  replica: ReplicaHandle,
  wakeSyncUpload: () => void,
  atoms: WorkspaceAtoms,
): InventoryActions => {
  const setCommandExecution = (state: CommandExecutionState) =>
    atoms.registry.set(atoms.commandExecution, state);

  const enqueue = async (
    operationId: string,
    command: SyncCommandEnvelope["command"],
    occurredAt: number,
    callerChoseId = false,
  ): Promise<void> => {
    const request = { operationId, command, occurredAt };
    try {
      await replica.enqueueCommand(request);
    } catch (cause) {
      const durable = callerChoseId
        ? undefined
        : await replica.readCommandStatus(operationId).catch(() => undefined);
      if (durable !== undefined) return;
      await replica.enqueueCommand(request).catch(() => {
        throw cause;
      });
    }
  };

  const runProjected = async <Tables, Result>(
    fallbackMessage: string,
    read: () => Promise<Tables>,
    run: (context: ProjectionContext<Tables>) => Promise<Result>,
    commandId: string = crypto.randomUUID(),
  ): Promise<Result> => {
    setCommandExecution({ _tag: "accepting", operationId: commandId });
    try {
      const tables = await read();
      const occurredAt = Date.now();
      const result = await run({
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
      setCommandExecution({ _tag: "pending", operationId: commandId, status: "queued" });
      wakeSyncUpload();
      return result;
    } catch (cause) {
      setCommandExecution({
        _tag: "failed",
        operationId: commandId,
        message: failureMessage(cause, fallbackMessage),
      });
      throw cause;
    }
  };

  const runCommand = <Result>(
    fallbackMessage: string,
    reads: CatalogRowsRequest,
    run: (context: CatalogProjectionContext) => Promise<Result>,
    commandId?: string,
  ): Promise<Result> =>
    runProjected(fallbackMessage, () => readCatalogRows(replica, reads), run, commandId);

  const runPurchasing = <Result>(
    fallbackMessage: string,
    reads: PurchasingRowsRequest,
    run: (context: PurchasingProjectionContext) => Promise<Result>,
  ): Promise<Result> =>
    runProjected(fallbackMessage, () => readPurchasingRows(replica, reads), run);

  const catalogCommand = async (
    context: ProjectionContext<unknown>,
    writes: ReadonlyArray<CatalogRowWrite>,
  ) => {
    if (writes.length === 0) return;
    await enqueue(
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
  };

  const createBatch: InventoryActions["createBatch"] = (input) =>
    runCommand(
      "The batch could not be saved locally.",
      { productIds: [input.productId] },
      async (context) => {
        const projected = projectCreateBatch(context, input);
        await catalogCommand(context, projected.writes);
        return projected.row;
      },
    );

  return {
    retrySync: async () => {
      await replica.retryRecovery?.();
    },
    createCategory: (input) =>
      runCommand(
        "The category could not be saved locally.",
        { allCategories: true },
        async (context) => {
          const projected = projectCreateCategory(context, input);
          await catalogCommand(context, projected.writes);
          return projected.row;
        },
      ),
    updateCategory: (input) =>
      runCommand(
        "The category could not be saved locally.",
        { allCategories: true },
        async (context) => {
          const projected = projectUpdateCategory(context, input);
          await catalogCommand(context, projected.writes);
          return projected.row;
        },
      ),
    deleteCategory: (id) =>
      runCommand(
        "The category could not be removed locally.",
        { categoryIds: [id], anyProductInCategory: id },
        async (context) => {
          const projected = projectDeleteCategory(context, id);
          await catalogCommand(context, projected.writes);
        },
      ),
    createProduct: (input) =>
      runCommand(
        "The product could not be saved locally.",
        { categoryIds: input.categoryId ? [input.categoryId] : [] },
        async (context) => {
          const projected = projectCreateProduct(context, input);
          await catalogCommand(context, projected.writes);
          return projected.row;
        },
      ),
    updateProduct: (input) =>
      runCommand(
        "The product could not be saved locally.",
        { allCategories: true, productIds: [input.id], batchesOfProductIds: [input.id] },
        async (context) => {
          const projected = projectUpdateProduct(context, input);
          await catalogCommand(context, projected.writes);
          return projected.row;
        },
      ),
    deleteProduct: (id) =>
      runCommand(
        "The product could not be removed locally.",
        { productIds: [id], batchesOfProductIds: [id] },
        async (context) => {
          const projected = projectDeleteProduct(context, id);
          await catalogCommand(context, projected.writes);
        },
      ),
    createProductWithBatch: (input) =>
      runCommand(
        "The product could not be saved locally.",
        { categoryIds: input.product.categoryId ? [input.product.categoryId] : [] },
        async (context) => {
          const product = projectCreateProduct(context, input.product);
          const batch = projectCreateBatch(withProjectedProduct(context, product.row), {
            ...input.batch,
            productId: product.row.id,
          });
          await catalogCommand(context, [...product.writes, ...batch.writes]);
          return { product: product.row, batch: batch.row };
        },
      ),
    createBatch,
    receiveBatch: createBatch,
    updateBatch: (input) =>
      runCommand(
        "The batch could not be saved locally.",
        { batchIds: [input.id] },
        async (context) => {
          const projected = projectUpdateBatch(context, input);
          await catalogCommand(context, projected.writes);
          return projected.row;
        },
      ),
    importInventory: (input) => {
      const productIds = input.lines.flatMap((line) => (line.productId ? [line.productId] : []));
      return runCommand(
        "The import could not be saved locally.",
        "categoryId" in input
          ? { categoryIds: [input.categoryId], productIds }
          : { allCategories: true, productIds },
        async (context) => {
          const category =
            "categoryId" in input
              ? { writes: [], id: input.categoryId, tables: context.tables }
              : importCategory(context, input.newCategory);
          const projected = projectImportInventory(
            { ids: context.ids, tables: category.tables },
            { categoryId: category.id, lines: input.lines },
          );
          const chunks = leadingChunks(category.writes, projected.chunks);
          for (const [index, chunk] of chunks.entries()) {
            const commandId = index === 0 ? context.commandId : crypto.randomUUID();
            await catalogCommand({ ...context, commandId }, chunk);
          }
          return {
            createdProducts: projected.createdProducts,
            createdBatches: projected.createdBatches,
            txid: context.occurredAt,
          };
        },
      );
    },
    issueInvoice: (input, invoiceId) =>
      runCommand(
        "Invoice could not be accepted locally.",
        {
          productIds: input.items.map((line) => line.productId),
          batchesOfProductIds: input.items.map((line) => line.productId),
        },
        async (context) => {
          const projection = projectIssuedInvoice({
            actor: context.actor,
            commandId: context.commandId,
            occurredAt: context.occurredAt,
            invoiceNumber: await readNextInvoiceNumber(replica, context.actor.organizationId),
            sale: input,
            products: context.tables.products,
            batches: context.tables.batches,
            ids: context.ids,
          });
          await enqueue(
            context.commandId,
            { _tag: "issueInvoice", payload: projection.command },
            context.occurredAt,
            invoiceId !== undefined,
          );
          return {
            invoiceId: projection.invoice.id,
            invoiceNumber: projection.invoice.invoiceNumber,
          };
        },
        invoiceId,
      ),
    saveSupplier: (input) =>
      runPurchasing(
        "The supplier could not be saved locally.",
        { allSuppliers: true },
        async (context) => {
          const projected = projectSaveSupplier(context, input);
          await catalogCommand(context, projected.writes);
          return projected.row;
        },
      ),
    deleteSupplier: (id) =>
      runPurchasing(
        "The supplier could not be removed locally.",
        { supplierIds: [id], anyOrderOfSupplier: id },
        async (context) => {
          const projected = projectDeleteSupplier(context, id);
          await catalogCommand(context, projected.writes);
        },
      ),
    saveOrderDraft: (input) => {
      const orderIds = input.id === undefined ? [] : [input.id];
      return runPurchasing(
        ORDER_NOT_SAVED,
        {
          supplierIds: [input.supplierId],
          orderIds,
          itemsOfOrderIds: orderIds,
          productIds: input.lines.map((line) => line.productId),
        },
        async (context) => {
          const projected = projectSaveOrderDraft(
            context,
            input,
            await readNextPurchaseOrderNumber(replica, context.actor.organizationId),
          );
          await catalogCommand(context, projected.writes);
          return projected.row;
        },
      );
    },
    sendOrder: (id) =>
      runPurchasing(ORDER_NOT_SAVED, { orderIds: [id], itemsOfOrderIds: [id] }, async (context) => {
        const projected = projectSendOrder(context, id);
        await catalogCommand(context, projected.writes);
        return projected.row;
      }),
    closeOrder: (id) =>
      runPurchasing(ORDER_NOT_SAVED, { orderIds: [id] }, async (context) => {
        const projected = projectCloseOrder(context, id);
        await catalogCommand(context, projected.writes);
        return projected.row;
      }),
    cancelOrder: (id) =>
      runPurchasing(ORDER_NOT_SAVED, { orderIds: [id] }, async (context) => {
        const projected = projectCancelOrder(context, id);
        await catalogCommand(context, projected.writes);
        return projected.row;
      }),
    receiveDelivery: (input) =>
      runPurchasing(
        "The delivery could not be saved locally.",
        { orderIds: [input.orderId], itemsOfOrderIds: [input.orderId], productsOfItems: true },
        async (context) => {
          const projected = projectReceiveDelivery(context, input);
          await catalogCommand(context, projected.writes);
          return projected.row;
        },
      ),
    syncNow: wakeSyncUpload,
  };
};
