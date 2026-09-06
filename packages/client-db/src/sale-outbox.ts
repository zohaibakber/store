import { IssueInvoiceCommand } from "@store/contracts/store.schema";
import * as Schema from "effect/Schema";

import type { PersistableCollection } from "./catalog-writes";
import type { SaleOutboxSnapshot } from "./invoice-projection";
import { InvoiceItemRow, InvoiceRow, StockMovementRow, type BatchRow } from "./rows";

export type { SaleOutboxSnapshot } from "./invoice-projection";

const SaleOutboxSnapshot = Schema.Struct({
  command: IssueInvoiceCommand,
  invoice: InvoiceRow,
  items: Schema.Array(InvoiceItemRow),
  movements: Schema.Array(StockMovementRow),
});

export type SaleOutboxStore = {
  put: (snapshot: SaleOutboxSnapshot) => Promise<void>;
  remove: (commandId: string) => Promise<void>;
  list: () => Promise<ReadonlyArray<SaleOutboxSnapshot>>;
};

export type SaleOutboxTables = {
  readonly invoices: PersistableCollection<InvoiceRow>;
  readonly invoiceItems: PersistableCollection<InvoiceItemRow>;
  readonly stockMovements: PersistableCollection<StockMovementRow>;
  readonly batches: PersistableCollection<BatchRow>;
};

const SaleOutboxRows = Schema.Record({
  key: Schema.String,
  value: SaleOutboxSnapshot,
});

const storageKey = (organizationId: string) => `tabaaq.sale-outbox.${organizationId}`;
const memoryStores = new Map<string, typeof SaleOutboxRows.Type>();

const readAll = (organizationId: string): typeof SaleOutboxRows.Type => {
  const storage = globalThis.localStorage;
  if (storage == null) return memoryStores.get(organizationId) ?? {};
  const raw = storage.getItem(storageKey(organizationId));
  if (raw == null) return {};
  try {
    return Schema.decodeUnknownSync(Schema.parseJson(SaleOutboxRows))(raw);
  } catch {
    return {};
  }
};

const writeAll = (organizationId: string, rows: typeof SaleOutboxRows.Type) => {
  const storage = globalThis.localStorage;
  if (storage == null) {
    memoryStores.set(organizationId, rows);
    return;
  }
  storage.setItem(storageKey(organizationId), JSON.stringify(rows));
};

export const memorySaleOutbox = (
  initial: ReadonlyArray<SaleOutboxSnapshot> = [],
): SaleOutboxStore => {
  const rows = new Map(initial.map((snapshot) => [snapshot.command.commandId, snapshot]));
  return {
    put: async (snapshot) => {
      rows.set(snapshot.command.commandId, snapshot);
    },
    remove: async (commandId) => {
      rows.delete(commandId);
    },
    list: async () => [...rows.values()],
  };
};

export const makeLocalSaleOutbox = (organizationId: string): SaleOutboxStore => ({
  put: async (snapshot) => {
    const rows = readAll(organizationId);
    rows[snapshot.command.commandId] = snapshot;
    writeAll(organizationId, rows);
  },
  remove: async (commandId) => {
    const rows = readAll(organizationId);
    delete rows[commandId];
    writeAll(organizationId, rows);
  },
  list: async () => Object.values(readAll(organizationId)),
});

export const restoreSaleOutbox = async (
  store: SaleOutboxStore,
  tables: SaleOutboxTables,
  persistWrites: (work: () => void) => Promise<void> = async (work) => {
    work();
  },
) => {
  for (const snapshot of await store.list()) {
    if (tables.invoices.state.get(snapshot.invoice.id)) {
      await store.remove(snapshot.command.commandId);
      continue;
    }
    await persistWrites(() => {
      tables.invoices.insert(snapshot.invoice);
      for (const item of snapshot.items) tables.invoiceItems.insert(item);
      for (const movement of snapshot.movements) tables.stockMovements.insert(movement);
      for (const movement of snapshot.movements) {
        const current = tables.batches.state.get(movement.batchId);
        if (!current || current.deletedAt !== null) continue;
        const packQuantity = Math.max(0, current.packQuantity + movement.packDelta);
        const unitQuantity = Math.max(0, current.unitQuantity + movement.unitDelta);
        tables.batches.update(movement.batchId, (draft) => {
          draft.packQuantity = packQuantity;
          draft.unitQuantity = unitQuantity;
        });
      }
    });
  }
};
