import {
  enqueueLocalCommand,
  OrganizationObjectCatalogUnsupported,
  projectIssuedInvoice,
  replicaInvoiceNumber,
  touchedEntitiesForCommand,
  type ReplicaSqliteHandle,
} from "@store/client-db";
import { ReplicaClientSequence, SyncCommandEnvelope, SyncEpoch } from "@store/contracts";
import { decodeOrganizationId } from "@store/contracts/ids";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import * as Schema from "effect/Schema";

import type { WorkspaceAtoms } from "./atoms";
import type { Inventory, InventoryActions, InventoryActor } from "./types";

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

export const makeInventoryActions = (
  inventory: ActionTables,
  actor: InventoryActor,
  replica: ReplicaSqliteHandle,
  wakeSyncUpload: () => void,
  atoms: WorkspaceAtoms,
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
    atoms.setCommandExecution({
      _tag: "accepting",
      operationId: commandId,
    });
    try {
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
      const state = replica.readCommandAllocation
        ? await replica.readCommandAllocation()
        : Schema.decodeUnknownSync(ReplicaCommandStateRow)(
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
      const enqueued = replica.enqueueLocal
        ? await replica.enqueueLocal(envelope, occurredAt)
        : await enqueueLocalCommand(replica, envelope, occurredAt);
      if (enqueued.changed) {
        const stamp = await replica.stamp();
        replica.publish({
          workspaceToken: stamp.workspaceToken,
          generationId: stamp.generationId,
          localCommitVersion: stamp.localCommitVersion,
          touchedEntities: touchedEntitiesForCommand(envelope),
          touchedKeys: [projection.invoice.id],
        });
      }
      atoms.setCommandExecution({
        _tag: "pending",
        operationId: commandId,
        status: "queued",
      });
      wakeSyncUpload();
      return {
        invoiceId: projection.invoice.id,
        invoiceNumber: projection.invoice.invoiceNumber,
      };
    } catch (cause) {
      atoms.setCommandExecution({
        _tag: "failed",
        operationId: commandId,
        message: cause instanceof Error ? cause.message : "Invoice could not be accepted locally.",
      });
      throw cause;
    }
  },
});
