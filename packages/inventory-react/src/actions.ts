import {
  projectCreateBatch,
  projectCreateCategory,
  projectCreateProduct,
  projectDeleteCategory,
  projectDeleteProduct,
  projectImportInventory,
  projectIssuedInvoice,
  projectUpdateBatch,
  projectUpdateCategory,
  projectUpdateProduct,
  readCatalogRows,
  readNextInvoiceNumber,
  touchedEntitiesForCommand,
  touchedKeysForCommand,
  type CatalogProjectionContext,
  type CatalogRowsRequest,
  type ProductRow,
  type ReplicaHandle,
} from "@store/client-db";
import { ReplicaClientSequence, SyncCommandEnvelope, SyncEpoch } from "@store/contracts";
import type { CatalogRowWrite } from "@store/contracts/catalog-write";
import { decodeOrganizationId } from "@store/contracts/ids";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import * as Schema from "effect/Schema";

import type { CommandExecutionState, WorkspaceAtoms } from "./atoms";
import type { InventoryActions, InventoryActor } from "./types";

const decodeEpoch = Schema.decodeUnknownSync(SyncEpoch);
const decodeClientSequence = Schema.decodeUnknownSync(ReplicaClientSequence);

const withProjectedProduct = (
  context: CatalogProjectionContext,
  product: ProductRow,
): CatalogProjectionContext => {
  const products = context.tables.products.state;
  return {
    ...context,
    tables: {
      ...context.tables,
      products: {
        state: {
          get: (id) => (id === product.id ? product : products.get(id)),
          values: function* () {
            yield product;
            yield* products.values();
          },
        },
      },
    },
  };
};

export const enqueueReplicaCommand = async (
  replica: ReplicaHandle,
  actor: InventoryActor,
  commandId: string,
  command: SyncCommandEnvelope["command"],
  occurredAt: number,
): Promise<SyncCommandEnvelope> => {
  const allocation = await replica.readCommandAllocation();
  const envelope: SyncCommandEnvelope = {
    organizationId: decodeOrganizationId(actor.organizationId),
    epoch: decodeEpoch(allocation.epoch),
    replicaId: actor.deviceId,
    clientSequence: decodeClientSequence(allocation.nextClientSequence),
    operationId: commandId,
    payloadHash: canonicalPayloadHash(command),
    command,
  };
  const enqueued = await replica.enqueueLocal(envelope, occurredAt);
  if (enqueued.changed) {
    const stamp = await replica.stamp();
    replica.publish({
      workspaceToken: stamp.workspaceToken,
      generationId: stamp.generationId,
      localCommitVersion: stamp.localCommitVersion,
      touchedEntities: touchedEntitiesForCommand(envelope),
      touchedKeys: touchedKeysForCommand(envelope),
    });
  }
  return envelope;
};

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

  const enqueue = (
    commandId: string,
    command: SyncCommandEnvelope["command"],
    occurredAt: number,
  ) => enqueueReplicaCommand(replica, actor, commandId, command, occurredAt);

  const runCommand = async <Result>(
    fallbackMessage: string,
    reads: CatalogRowsRequest,
    run: (context: CatalogProjectionContext) => Promise<Result>,
  ): Promise<Result> => {
    const commandId = crypto.randomUUID();
    setCommandExecution({ _tag: "accepting", operationId: commandId });
    try {
      const tables = await readCatalogRows(replica, reads);
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

  const catalogCommand = async (
    context: CatalogProjectionContext,
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
    importInventory: (input) =>
      runCommand(
        "The import could not be saved locally.",
        {
          categoryIds: [input.categoryId],
          productIds: input.lines.flatMap((line) => (line.productId ? [line.productId] : [])),
        },
        async (context) => {
          const projected = projectImportInventory(
            { ids: context.ids, tables: context.tables },
            input,
          );
          for (const [index, chunk] of projected.chunks.entries()) {
            const commandId = index === 0 ? context.commandId : crypto.randomUUID();
            await catalogCommand({ ...context, commandId }, chunk);
          }
          return {
            createdProducts: projected.createdProducts,
            createdBatches: projected.createdBatches,
            txid: context.occurredAt,
          };
        },
      ),
    issueInvoice: (input) =>
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
          );
          return {
            invoiceId: projection.invoice.id,
            invoiceNumber: projection.invoice.invoiceNumber,
          };
        },
      ),
  };
};
