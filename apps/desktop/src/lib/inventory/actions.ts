import type { AbstractPowerSyncDatabase } from "@powersync/common";
import {
  InventoryFailure,
  makeCatalogWrites,
  makeInvoiceWrites,
  makeLocalSaleOutbox,
  OrganizationObjectCatalogUnsupported,
  projectIssuedInvoice,
  replicaInvoiceNumber,
  submitImportInventory,
  submitOrganizationObjectCommand,
  type ReplicaSqliteHandle,
} from "@store/client-db";
import {
  incrementDecimalSequence,
  ReplicaClientSequence,
  SyncCommandEnvelope,
  SyncEpoch,
  type ImportInventoryCommand,
} from "@store/contracts";
import { decodeOrganizationId } from "@store/contracts/ids";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import { PowerSyncTransactor } from "@tanstack/powersync-db-collection";
import type { DbClient } from "@tanstack/react-db";
import * as Schema from "effect/Schema";

import type { InventoryHost } from "@/lib/inventory-host";

import type { Inventory, InventoryActions, InventoryActor } from "./types";

export const persistSale =
  (dbClient: DbClient, powerSync: AbstractPowerSyncDatabase) => async (work: () => void) => {
    const transaction = dbClient.createTransaction({
      autoCommit: false,
      mutationFn: async ({ transaction: pending }) => {
        await new PowerSyncTransactor({ database: powerSync }).applyTransaction(pending);
      },
    });
    transaction.mutate(work);
    await transaction.commit();
    await transaction.isPersisted.promise;
  };

type ActionTables = Pick<
  Inventory,
  | "batches"
  | "categories"
  | "invoiceItems"
  | "invoices"
  | "products"
  | "stockMovements"
  | "dbClient"
>;

export const makeInventoryActions = (
  inventory: ActionTables,
  host: InventoryHost,
  actor: InventoryActor,
  runtime: {
    readonly persistSale: (work: () => void) => Promise<void>;
    readonly waitForUploadDrain: () => Promise<void>;
  },
): InventoryActions => {
  const writes = makeCatalogWrites(inventory, actor);
  const saleOutbox = makeLocalSaleOutbox(actor.organizationId);
  const invoices = makeInvoiceWrites(
    {
      ...inventory,
      persist: runtime.persistSale,
      journalSale: (snapshot) => saleOutbox.put(snapshot),
    },
    actor,
  );
  return {
    createCategory: writes.createCategory,
    updateCategory: writes.updateCategory,
    deleteCategory: writes.deleteCategory,
    createProduct: writes.createProduct,
    updateProduct: writes.updateProduct,
    deleteProduct: writes.deleteProduct,
    createBatch: async (input) => {
      const packQuantity = input.packQuantity ?? 0;
      const unitQuantity = input.unitQuantity ?? 0;
      if (packQuantity + unitQuantity === 0) throw new Error("Add some stock to the batch.");
      return writes.createBatch(input);
    },
    updateBatch: writes.updateBatch,
    importInventory: async (input) => {
      await runtime.waitForUploadDrain();
      const command: ImportInventoryCommand = {
        commandId: crypto.randomUUID(),
        deviceId: actor.deviceId,
        occurredAt: Date.now(),
        input,
      };
      return submitImportInventory({
        apiBaseUrl: host.apiBaseUrl,
        authenticatedFetch: host.authenticatedFetch,
        command,
      });
    },
    issueInvoice: invoices.issueInvoice,
  };
};

const ReplicaCommandStateRow = Schema.Struct({
  epoch: Schema.String,
  nextClientSequence: Schema.String,
});

const catalogUnsupported = (action: string): Promise<never> =>
  Promise.reject(
    new OrganizationObjectCatalogUnsupported({
      message: "The organization-object backend does not accept catalog commands.",
      action,
    }),
  );

export const makeOrganizationObjectActions = (
  inventory: ActionTables,
  host: InventoryHost,
  actor: InventoryActor,
  replica: ReplicaSqliteHandle,
): InventoryActions => ({
  createCategory: () => catalogUnsupported("createCategory"),
  updateCategory: () => catalogUnsupported("updateCategory"),
  deleteCategory: () => catalogUnsupported("deleteCategory"),
  createProduct: () => catalogUnsupported("createProduct"),
  updateProduct: () => catalogUnsupported("updateProduct"),
  deleteProduct: () => catalogUnsupported("deleteProduct"),
  createBatch: () => catalogUnsupported("createBatch"),
  updateBatch: () => catalogUnsupported("updateBatch"),
  importInventory: () => catalogUnsupported("importInventory"),
  issueInvoice: async (input) => {
    const commandId = crypto.randomUUID();
    const occurredAt = Date.now();
    const projection = projectIssuedInvoice({
      actor,
      commandId,
      occurredAt,
      invoiceNumber: replicaInvoiceNumber(inventory.invoices.state.values()),
      sale: input,
      products: inventory.products,
      batches: inventory.batches,
      ids: {
        now: () => occurredAt,
        operationId: () => commandId,
        rowId: () => crypto.randomUUID(),
      },
    });
    const command = { _tag: "issueInvoice" as const, payload: projection.command };
    const state = Schema.decodeUnknownSync(ReplicaCommandStateRow)(
      (
        await replica.query(
          `select epoch, nextClientSequence from replica_state where id = 'singleton'`,
          [],
        )
      )[0],
    );
    const envelope: SyncCommandEnvelope = {
      organizationId: decodeOrganizationId(actor.organizationId),
      epoch: Schema.decodeUnknownSync(SyncEpoch)(state.epoch),
      replicaId: actor.deviceId,
      clientSequence: Schema.decodeUnknownSync(ReplicaClientSequence)(state.nextClientSequence),
      operationId: commandId,
      payloadHash: canonicalPayloadHash(command),
      command,
    };
    const encoded = Schema.encodeSync(SyncCommandEnvelope)(envelope);
    await replica.query(
      `insert into command_outbox (
        operationId, status, envelopeJson, clientSequence, createdAt, attempts, outcomeUncertain
      ) values (?, 'pending', ?, ?, ?, 0, 0)`,
      [envelope.operationId, JSON.stringify(encoded), envelope.clientSequence, occurredAt],
    );
    await replica.query(
      `update replica_state set nextClientSequence = ?, localCommitVersion = localCommitVersion + 1 where id = 'singleton'`,
      [incrementDecimalSequence(envelope.clientSequence)],
    );
    const stamp = await replica.stamp();
    replica.publish({
      workspaceToken: stamp.workspaceToken,
      generationId: stamp.generationId,
      localCommitVersion: stamp.localCommitVersion,
      touchedEntities: ["invoice", "invoiceItem", "stockMovement", "batch"],
      touchedKeys: [projection.invoice.id],
    });
    const receipt = await submitOrganizationObjectCommand(
      envelope,
      host.authenticatedFetch,
      host.apiBaseUrl,
    );
    if (receipt.result._tag === "issueInvoice") {
      return {
        invoiceId: receipt.result.invoiceId,
        invoiceNumber: receipt.result.invoiceNumber,
      };
    }
    throw new InventoryFailure({
      message: receipt.result.message,
      reason: { _tag: "rejected", code: receipt.result.code },
    });
  },
});
