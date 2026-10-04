import type { CreateBatchInput, SyncCommandEnvelope } from "@store/contracts";
import { CatalogRefusal } from "@store/contracts/catalog-refusal";
import type { CatalogRowWrite } from "@store/contracts/catalog-write";
import {
  ReplicaStorageError,
  type Commit,
  type CreateProductWithBatchInput,
  type ImportInventoryRequest,
  type InventoryStore,
} from "@store/contracts/replica";
import { replicaState } from "@store/db/replica.schema";
import { mapReplicaStoreFailure, type ReplicaStore, type SyncScheduler } from "@store/sync";
import type { SqliteReplicaHandle } from "@store/sync/sql-client";
import { eq } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type * as RpcGroup from "effect/rpc/RpcGroup";

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
} from "../catalog-projection";
import {
  readCatalogRows,
  readNextInvoiceNumber,
  readNextPurchaseOrderNumber,
  readPurchasingRows,
  type CatalogRowsRequest,
  type PurchasingRowsRequest,
} from "../catalog-read";
import { projectIssuedInvoice } from "../invoice-projection";
import type { ProjectionContext } from "../projection-context";
import {
  projectCancelOrder,
  projectCloseOrder,
  projectDeleteSupplier,
  projectReceiveDelivery,
  projectSaveOrderDraft,
  projectSaveSupplier,
  projectSendOrder,
  type PurchasingProjectionContext,
} from "../purchasing-projection";
import type { ReadSubset } from "../replica/collection-read";
import { readSnapshotSubset, snapshotRunnerFromHandle } from "../replica/snapshot-read";
import type { CommandAdmission } from "./admission";
import {
  importCategory,
  leadingChunks,
  removed,
  withProjectedProduct,
  type Projected,
} from "./projected";

const READER = "store";

type CommandFailure = CatalogRefusal | ReturnType<typeof mapReplicaStoreFailure>;

type Command = SyncCommandEnvelope["command"];

type CommandHandlers = Pick<
  RpcGroup.HandlersFrom<RpcGroup.Rpcs<typeof InventoryStore>>,
  | "CreateCategory"
  | "UpdateCategory"
  | "DeleteCategory"
  | "CreateProduct"
  | "CreateProductWithBatch"
  | "UpdateProduct"
  | "DeleteProduct"
  | "CreateBatch"
  | "ReceiveBatch"
  | "UpdateBatch"
  | "ImportInventory"
  | "IssueInvoice"
  | "SaveSupplier"
  | "DeleteSupplier"
  | "SaveOrderDraft"
  | "SendOrder"
  | "CloseOrder"
  | "CancelOrder"
  | "ReceiveDelivery"
>;

export const makeCommandHandlers = ({
  admission,
  store,
  scheduler,
  replica,
}: {
  readonly admission: CommandAdmission["Service"];
  readonly store: ReplicaStore["Service"];
  readonly scheduler: SyncScheduler["Service"];
  readonly replica: SqliteReplicaHandle;
}): CommandHandlers => {
  const snapshot = snapshotRunnerFromHandle(replica);
  const subset: ReadSubset = (spec) => readSnapshotSubset(snapshot, READER, spec);

  const actor = replica.db
    .select({
      organizationId: replicaState.organizationId,
      userId: replicaState.userId,
      deviceId: replicaState.replicaId,
    })
    .from(replicaState)
    .where(eq(replicaState.id, "singleton"))
    .all()
    .pipe(
      Effect.mapError(mapReplicaStoreFailure),
      Effect.flatMap(([identity]) =>
        identity === undefined
          ? Effect.fail(new ReplicaStorageError({ message: "Replica state is missing." }))
          : Effect.succeed(identity),
      ),
    );

  const begin = Effect.fn("InventoryStore.begin")(function* <Tables>(
    read: Effect.Effect<Tables, unknown>,
    commandId: string = crypto.randomUUID(),
  ) {
    const identity = yield* actor;
    const tables = yield* Effect.mapError(read, mapReplicaStoreFailure);
    const occurredAt = yield* Clock.currentTimeMillis;
    return {
      actor: identity,
      commandId,
      occurredAt,
      ids: {
        now: () => occurredAt,
        operationId: () => commandId,
        rowId: () => crypto.randomUUID(),
      },
      tables,
    } satisfies ProjectionContext<Tables>;
  });

  const enqueue = Effect.fn("InventoryStore.enqueue")(function* (
    operationId: string,
    command: Command,
    occurredAt: number,
  ) {
    const committed = yield* store.enqueueCommand({ operationId, command, occurredAt });
    yield* scheduler.wake("localWrite");
    return committed.value satisfies Commit;
  }, Effect.mapError(mapReplicaStoreFailure));

  const unchanged = (operationId: string): Effect.Effect<Commit, CommandFailure> =>
    store.readStamp().pipe(
      Effect.mapError(mapReplicaStoreFailure),
      Effect.map((stamp) => ({ operationId, status: "integrated", stamp })),
    );

  const catalogWrite = (
    context: ProjectionContext<unknown>,
    writes: ReadonlyArray<CatalogRowWrite>,
  ): Effect.Effect<Commit, CommandFailure> =>
    writes.length === 0
      ? unchanged(context.commandId)
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

  const write = Effect.fnUntraced(function* <Tables, Row>(
    read: Effect.Effect<Tables, unknown>,
    project: (context: ProjectionContext<Tables>) => Effect.Effect<Projected<Row>, CommandFailure>,
  ) {
    const context = yield* begin(read);
    const projected = yield* project(context);
    const commit = yield* catalogWrite(context, projected.writes);
    return { commit, row: projected.row };
  }, admission.admit);

  const catalog = <Row>(
    rows: CatalogRowsRequest,
    project: (context: CatalogProjectionContext) => Result.Result<Projected<Row>, CatalogRefusal>,
  ) => write(readCatalogRows(subset, rows), (context) => Effect.fromResult(project(context)));

  const purchasing = <Row>(
    rows: PurchasingRowsRequest,
    project: (
      context: PurchasingProjectionContext,
    ) => Result.Result<Projected<Row>, CatalogRefusal>,
  ) => write(readPurchasingRows(subset, rows), (context) => Effect.fromResult(project(context)));

  const saved = <Row, E>(written: Effect.Effect<{ commit: Commit; row: Row }, E>) =>
    Effect.map(written, ({ commit, row }) => ({ ...commit, result: row }));

  const deleted = <E>(written: Effect.Effect<{ commit: Commit; row: void }, E>) =>
    Effect.map(written, ({ commit }) => commit);

  const createBatch = (input: CreateBatchInput) =>
    saved(
      catalog({ productIds: [input.productId] }, (context) => projectCreateBatch(context, input)),
    );

  const createProductWithBatch = (input: CreateProductWithBatchInput) =>
    catalog(
      { categoryIds: input.product.categoryId ? [input.product.categoryId] : [] },
      (context) =>
        Result.gen(function* () {
          const product = yield* projectCreateProduct(context, input.product);
          const batch = yield* projectCreateBatch(withProjectedProduct(context, product.row), {
            ...input.batch,
            productId: product.row.id,
          });
          return {
            writes: [...product.writes, ...batch.writes],
            row: { product: product.row, batch: batch.row },
          };
        }),
    );

  const importInventory = Effect.fnUntraced(function* (input: ImportInventoryRequest) {
    const productIds = input.lines.flatMap((line) => (line.productId ? [line.productId] : []));
    const context = yield* begin(
      readCatalogRows(
        subset,
        "categoryId" in input
          ? { categoryIds: [input.categoryId], productIds }
          : { allCategories: true, productIds },
      ),
    );
    const projected = yield* Effect.fromResult(
      Result.gen(function* () {
        const category =
          "categoryId" in input
            ? { writes: [], id: input.categoryId, tables: context.tables }
            : yield* importCategory(context, input.newCategory);
        const imported = yield* projectImportInventory(
          { ids: context.ids, tables: category.tables },
          { categoryId: category.id, lines: input.lines },
        );
        return { ...imported, chunks: leadingChunks(category.writes, imported.chunks) };
      }),
    );
    const commits = yield* Effect.forEach(projected.chunks, (chunk, index) =>
      catalogWrite(
        { ...context, commandId: index === 0 ? context.commandId : crypto.randomUUID() },
        chunk,
      ),
    );
    const last = commits.at(-1) ?? (yield* unchanged(context.commandId));
    return {
      operationId: context.commandId,
      status: last.status,
      stamp: last.stamp,
      result: {
        createdProducts: projected.createdProducts,
        createdBatches: projected.createdBatches,
        txid: context.occurredAt,
      },
    };
  }, admission.admit);

  const issueInvoice: CommandHandlers["IssueInvoice"] = Effect.fnUntraced(function* ({
    input,
    invoiceId,
  }) {
    const productIds = input.items.map((line) => line.productId);
    const context = yield* begin(
      readCatalogRows(subset, { productIds, batchesOfProductIds: productIds }),
      invoiceId,
    );
    const invoiceNumber = yield* Effect.mapError(
      readNextInvoiceNumber(subset, context.actor.organizationId),
      mapReplicaStoreFailure,
    );
    const projection = yield* Effect.fromResult(
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
    const commit = yield* enqueue(
      context.commandId,
      { _tag: "issueInvoice", payload: projection.command },
      context.occurredAt,
    );
    return {
      ...commit,
      result: {
        invoiceId: projection.invoice.id,
        invoiceNumber: projection.invoice.invoiceNumber,
      },
    };
  }, admission.admit);

  return {
    CreateCategory: (input) =>
      saved(catalog({ allCategories: true }, (context) => projectCreateCategory(context, input))),
    UpdateCategory: (input) =>
      saved(catalog({ allCategories: true }, (context) => projectUpdateCategory(context, input))),
    DeleteCategory: ({ id }) =>
      deleted(
        catalog({ categoryIds: [id], anyProductInCategory: id }, (context) =>
          Result.map(projectDeleteCategory(context, id), removed),
        ),
      ),
    CreateProduct: (input) =>
      saved(
        catalog({ categoryIds: input.categoryId ? [input.categoryId] : [] }, (context) =>
          projectCreateProduct(context, input),
        ),
      ),
    CreateProductWithBatch: (input) => saved(createProductWithBatch(input)),
    UpdateProduct: (input) =>
      saved(
        catalog(
          { allCategories: true, productIds: [input.id], batchesOfProductIds: [input.id] },
          (context) => projectUpdateProduct(context, input),
        ),
      ),
    DeleteProduct: ({ id }) =>
      deleted(
        catalog({ productIds: [id], batchesOfProductIds: [id] }, (context) =>
          Result.map(projectDeleteProduct(context, id), removed),
        ),
      ),
    CreateBatch: createBatch,
    ReceiveBatch: createBatch,
    UpdateBatch: (input) =>
      saved(catalog({ batchIds: [input.id] }, (context) => projectUpdateBatch(context, input))),
    ImportInventory: importInventory,
    IssueInvoice: issueInvoice,
    SaveSupplier: (input) =>
      saved(purchasing({ allSuppliers: true }, (context) => projectSaveSupplier(context, input))),
    DeleteSupplier: ({ id }) =>
      deleted(
        purchasing({ supplierIds: [id], anyOrderOfSupplier: id }, (context) =>
          Result.map(projectDeleteSupplier(context, id), removed),
        ),
      ),
    SaveOrderDraft: (input) => {
      const orderIds = input.id === undefined ? [] : [input.id];
      return saved(
        write(
          readPurchasingRows(subset, {
            supplierIds: [input.supplierId],
            orderIds,
            itemsOfOrderIds: orderIds,
            productIds: input.lines.map((line) => line.productId),
          }),
          (context) =>
            readNextPurchaseOrderNumber(subset, context.actor.organizationId).pipe(
              Effect.mapError(mapReplicaStoreFailure),
              Effect.flatMap((orderNumber) =>
                Effect.fromResult(projectSaveOrderDraft(context, input, orderNumber)),
              ),
            ),
        ),
      );
    },
    SendOrder: ({ id }) =>
      saved(
        purchasing({ orderIds: [id], itemsOfOrderIds: [id] }, (context) =>
          projectSendOrder(context, id),
        ),
      ),
    CloseOrder: ({ id }) =>
      saved(purchasing({ orderIds: [id] }, (context) => projectCloseOrder(context, id))),
    CancelOrder: ({ id }) =>
      saved(purchasing({ orderIds: [id] }, (context) => projectCancelOrder(context, id))),
    ReceiveDelivery: (input) =>
      saved(
        purchasing(
          { orderIds: [input.orderId], itemsOfOrderIds: [input.orderId], productsOfItems: true },
          (context) => projectReceiveDelivery(context, input),
        ),
      ),
  };
};
