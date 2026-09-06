import type { CreateInvoiceInput, IssueInvoiceResult } from "@store/contracts/store.schema";

import {
  type CatalogActor,
  type CatalogWriteIds,
  type CatalogWriteTables,
  type PersistableCollection,
} from "./catalog-writes";
import {
  projectIssuedInvoice,
  replicaInvoiceNumber,
  saleSnapshotFromProjection,
} from "./invoice-projection";
import type { InvoiceItemRow, InvoiceRow, StockMovementRow } from "./rows";
import type { SaleOutboxSnapshot } from "./sale-outbox";

export type InvoiceWriteTables = CatalogWriteTables & {
  readonly invoices: PersistableCollection<InvoiceRow>;
  readonly invoiceItems: PersistableCollection<InvoiceItemRow>;
  readonly stockMovements: PersistableCollection<StockMovementRow>;
  readonly persist: (work: () => void) => Promise<void>;
  readonly journalSale?: (snapshot: SaleOutboxSnapshot) => Promise<void>;
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
    await tables.persist(() => {
      tables.invoices.insert(projection.invoice);
      for (const item of projection.items) tables.invoiceItems.insert(item);
      for (const movement of projection.movements) tables.stockMovements.insert(movement);
      for (const batch of projection.batchUpdates) {
        tables.batches.update(batch.id, (draft) => Object.assign(draft, batch));
      }
    });
    await tables.journalSale?.(saleSnapshotFromProjection(projection));
    return {
      invoiceId: projection.invoice.id,
      invoiceNumber: projection.invoice.invoiceNumber,
    };
  },
});

export type InvoiceWrites = ReturnType<typeof makeInvoiceWrites>;
