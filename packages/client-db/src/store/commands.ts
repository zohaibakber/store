import {
  OperationId,
  type CreateBatchInput,
  type StaffId,
  StaffPermission,
  SyncCommandEnvelope,
} from "@store/contracts";
import type { StaffRefusal } from "@store/contracts";
import { CatalogRefusal } from "@store/contracts/catalog-refusal";
import type { CatalogRowWrite } from "@store/contracts/catalog-write";
import {
  ReplicaStorageError,
  type Commit,
  type CreateProductWithBatchInput,
  type InventoryStore,
} from "@store/contracts/replica";
import { commandStaff, replicaState } from "@store/db/replica.schema";
import { mapReplicaStoreFailure, type ReplicaStore, type SyncScheduler } from "@store/sync";
import type { SqliteReplicaHandle } from "@store/sync/sql-client";
import { eq } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import type * as RpcGroup from "effect/rpc/RpcGroup";

import {
  projectCreateBatch,
  projectCreateCategory,
  projectCreateProduct,
  projectDeleteCategory,
  projectDeleteProduct,
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
import type { CatalogWriteIds, Projected, ProjectionContext } from "../projection-context";
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
  RowIdSupplyMismatch,
  countingRowIds,
  drawnRowIds,
  withProjectedProduct,
} from "./projected";
import type { StaffGate } from "./staff-gate";

const READER = "store";

const SELL: StaffPermission = "sell";

const MANAGE_STOCK: StaffPermission = "manageStock";

type CommandFailure = CatalogRefusal | StaffRefusal | ReturnType<typeof mapReplicaStoreFailure>;

type Command = SyncCommandEnvelope["command"];

type BegunContext<Tables> = Omit<ProjectionContext<Tables>, "ids"> & {
  readonly ids: Omit<CatalogWriteIds, "rowId">;
};

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
  gate,
  crypto,
}: {
  readonly admission: CommandAdmission["Service"];
  readonly store: ReplicaStore["Service"];
  readonly scheduler: SyncScheduler["Service"];
  readonly replica: SqliteReplicaHandle;
  readonly gate: StaffGate["Service"];
  readonly crypto: Crypto.Crypto;
}): CommandHandlers => {
  const newId = Effect.orDie(crypto.randomUUIDv4());

  const withRowIds = Effect.fn("InventoryStore.withRowIds")(function* <Tables, A, E>(
    context: BegunContext<Tables>,
    project: (context: ProjectionContext<Tables>) => Result.Result<A, E>,
  ) {
    const counting = countingRowIds();
    const dry = project({ ...context, ids: { ...context.ids, rowId: counting.rowId } });
    if (Result.isFailure(dry)) return yield* Effect.fromResult(dry);
    const drawn = yield* Effect.replicateEffect(newId, counting.used());
    const supply = drawnRowIds(drawn);
    const projected = project({ ...context, ids: { ...context.ids, rowId: supply.rowId } });
    if (!supply.balanced()) {
      return yield* Effect.die(
        new RowIdSupplyMismatch({ drawn: drawn.length, taken: supply.used() }),
      );
    }
    return yield* Effect.fromResult(projected);
  });

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
    givenCommandId?: string,
  ) {
    const commandId = givenCommandId ?? (yield* newId);
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
      },
      tables,
    } satisfies BegunContext<Tables>;
  });

  const enqueue = Effect.fn("InventoryStore.enqueue")(function* (
    operationId: OperationId,
    command: Command,
    occurredAt: number,
    staff: Option.Option<StaffId>,
  ) {
    if (Option.isSome(staff)) {
      yield* replica.db
        .insert(commandStaff)
        .values({ operationId, staffId: staff.value, at: occurredAt })
        .onConflictDoNothing();
    }
    const committed = yield* store.enqueueCommand({ operationId, command, occurredAt });
    yield* scheduler.wake("localWrite");
    return committed.value satisfies Commit;
  }, Effect.mapError(mapReplicaStoreFailure));

  const unchanged = (operationId: string): Effect.Effect<Commit, CommandFailure> =>
    store.readStamp.pipe(
      Effect.mapError(mapReplicaStoreFailure),
      Effect.map((stamp) => ({ operationId, status: "integrated", stamp })),
    );

  const catalogWrite = (
    context: Pick<BegunContext<unknown>, "actor" | "commandId" | "occurredAt">,
    writes: ReadonlyArray<CatalogRowWrite>,
    staff: Option.Option<StaffId>,
  ): Effect.Effect<Commit, CommandFailure> =>
    writes.length === 0
      ? unchanged(OperationId.make(context.commandId))
      : enqueue(
          OperationId.make(context.commandId),
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
          staff,
        );

  const write = Effect.fn("InventoryStore.write")(function* <Tables, Row>(
    read: Effect.Effect<Tables, unknown>,
    project: (context: BegunContext<Tables>) => Effect.Effect<Projected<Row>, CommandFailure>,
  ) {
    const staff = yield* gate.authorize(MANAGE_STOCK);
    const context = yield* begin(read);
    const projected = yield* project(context);
    const commit = yield* catalogWrite(context, projected.writes, staff);
    return { commit, row: projected.row };
  }, admission.admit);

  const catalog = <Row>(
    rows: CatalogRowsRequest,
    project: (context: CatalogProjectionContext) => Result.Result<Projected<Row>, CatalogRefusal>,
  ) => write(readCatalogRows(subset, rows), (context) => withRowIds(context, project));

  const purchasing = <Row>(
    rows: PurchasingRowsRequest,
    project: (
      context: PurchasingProjectionContext,
    ) => Result.Result<Projected<Row>, CatalogRefusal>,
  ) => write(readPurchasingRows(subset, rows), (context) => withRowIds(context, project));

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

  const issueInvoice: CommandHandlers["IssueInvoice"] = Effect.fn("InventoryStore.issueInvoice")(
    function* ({ input, invoiceId }) {
      const staff = yield* gate.authorize(SELL);
      const productIds = input.items.map((line) => line.productId);
      const context = yield* begin(
        readCatalogRows(subset, { productIds, batchesOfProductIds: productIds }),
        invoiceId,
      );
      const invoiceNumber = yield* Effect.mapError(
        readNextInvoiceNumber(subset, context.actor.organizationId),
        mapReplicaStoreFailure,
      );
      const projection = yield* withRowIds(context, (supplied) =>
        projectIssuedInvoice({
          actor: supplied.actor,
          commandId: supplied.commandId,
          occurredAt: supplied.occurredAt,
          invoiceNumber,
          sale: input,
          products: supplied.tables.products,
          batches: supplied.tables.batches,
          ids: supplied.ids,
        }),
      );
      const commit = yield* enqueue(
        OperationId.make(context.commandId),
        { _tag: "issueInvoice", payload: projection.command },
        context.occurredAt,
        staff,
      );
      return {
        ...commit,
        result: {
          invoiceId: projection.command.invoiceId,
          invoiceNumber: projection.command.invoiceNumber,
        },
      };
    },
    admission.admit,
  );

  return {
    CreateCategory: (input) =>
      saved(catalog({ allCategories: true }, (context) => projectCreateCategory(context, input))),
    UpdateCategory: (input) =>
      saved(catalog({ allCategories: true }, (context) => projectUpdateCategory(context, input))),
    DeleteCategory: ({ id }) =>
      deleted(
        catalog({ categoryIds: [id], anyProductInCategory: id }, (context) =>
          projectDeleteCategory(context, id),
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
          projectDeleteProduct(context, id),
        ),
      ),
    CreateBatch: createBatch,
    ReceiveBatch: createBatch,
    UpdateBatch: (input) =>
      saved(catalog({ batchIds: [input.id] }, (context) => projectUpdateBatch(context, input))),
    IssueInvoice: issueInvoice,
    SaveSupplier: (input) =>
      saved(purchasing({ allSuppliers: true }, (context) => projectSaveSupplier(context, input))),
    DeleteSupplier: ({ id }) =>
      deleted(
        purchasing({ supplierIds: [id], anyOrderOfSupplier: id }, (context) =>
          projectDeleteSupplier(context, id),
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
                withRowIds(context, (supplied) =>
                  projectSaveOrderDraft(supplied, input, orderNumber),
                ),
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
