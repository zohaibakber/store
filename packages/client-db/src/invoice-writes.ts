import type { SyncEntityChange } from "@store/contracts";
import type {
  CreateInvoiceInput,
  IssueInvoiceCommand,
  IssueInvoiceResult,
} from "@store/contracts/store.schema";

import {
  type CatalogActor,
  type CatalogWriteIds,
  type CatalogWriteTables,
  type PersistableCollection,
} from "./catalog-writes";
import { projectIssuedInvoice, replicaInvoiceNumber } from "./invoice-projection";
import type { InvoiceItemRow, InvoiceRow, StockMovementRow } from "./rows";

export type InvoiceWriteTables = CatalogWriteTables & {
  readonly invoices: PersistableCollection<InvoiceRow>;
  readonly invoiceItems: PersistableCollection<InvoiceItemRow>;
  readonly stockMovements: PersistableCollection<StockMovementRow>;
  readonly submitInvoice: (
    command: IssueInvoiceCommand,
    changes: ReadonlyArray<SyncEntityChange>,
  ) => Promise<void>;
};

const defaultIds: CatalogWriteIds = {
  now: Date.now,
  operationId: () => crypto.randomUUID(),
  rowId: () => crypto.randomUUID(),
};

export const makeInvoiceWrites = (
  tables: InvoiceWriteTables,
  actor: CatalogActor,
  ids: CatalogWriteIds = defaultIds,
) => ({
  issueInvoice: async (input: CreateInvoiceInput): Promise<IssueInvoiceResult> => {
    const commandId = ids.operationId();
    const occurredAt = ids.now();
    const invoiceNumber = replicaInvoiceNumber(tables.invoices.state.values());
    const projection = projectIssuedInvoice({
      actor,
      commandId,
      occurredAt,
      invoiceNumber,
      sale: input,
      products: tables.products,
      batches: tables.batches,
      ids,
    });
    const changes: SyncEntityChange[] = [
      {
        entity: "invoice",
        action: "upsert",
        entityId: projection.invoice.id,
        rowVersion: projection.invoice.rowVersion,
        row: projection.invoice,
      },
      ...projection.items.map((row): SyncEntityChange => ({
        entity: "invoiceItem",
        action: "upsert",
        entityId: row.id,
        rowVersion: row.rowVersion,
        row,
      })),
      ...projection.movements.map((row): SyncEntityChange => ({
        entity: "stockMovement",
        action: "upsert",
        entityId: row.id,
        rowVersion: 1,
        row,
      })),
      ...projection.batchUpdates.map((row): SyncEntityChange => ({
        entity: "batch",
        action: "upsert",
        entityId: row.id,
        rowVersion: row.rowVersion,
        row,
      })),
    ];
    await tables.submitInvoice(projection.command, changes);
    return {
      invoiceId: projection.invoice.id,
      invoiceNumber: projection.invoice.invoiceNumber,
    };
  },
});

export type InvoiceWrites = ReturnType<typeof makeInvoiceWrites>;
