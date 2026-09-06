import type { AbstractPowerSyncDatabase } from "@powersync/common";
import { IssueInvoiceCommand } from "@store/contracts/store.schema";
import * as Schema from "effect/Schema";

import type { PersistableCollection } from "./catalog-writes";
import type { SaleOutboxSnapshot } from "./invoice-projection";
import { InvoiceItemRow, InvoiceRow, StockMovementRow, type BatchRow } from "./rows";

export type { SaleOutboxSnapshot } from "./invoice-projection";

export const SALE_OUTBOX_TABLE = "sale_outbox";

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

type SaleOutboxRow = {
  readonly id: string;
  readonly payload: string;
};

export const makePowerSyncSaleOutbox = (database: AbstractPowerSyncDatabase): SaleOutboxStore => ({
  put: async (snapshot) => {
    await database.execute(
      `INSERT OR REPLACE INTO ${SALE_OUTBOX_TABLE} (id, payload, createdAt) VALUES (?, ?, ?)`,
      [snapshot.command.commandId, JSON.stringify(snapshot), snapshot.invoice.createdAt],
    );
  },
  remove: async (commandId) => {
    await database.execute(`DELETE FROM ${SALE_OUTBOX_TABLE} WHERE id = ?`, [commandId]);
  },
  list: async () => {
    try {
      const rows = await database.getAll<SaleOutboxRow>(
        `SELECT id, payload FROM ${SALE_OUTBOX_TABLE}`,
      );
      return rows.map((row) =>
        Schema.decodeUnknownSync(SaleOutboxSnapshot)(JSON.parse(row.payload)),
      );
    } catch (cause) {
      if (cause instanceof Error && /no such table/i.test(cause.message)) return [];
      throw cause;
    }
  },
});

export const restoreSaleOutbox = async (
  store: SaleOutboxStore,
  tables: SaleOutboxTables,
  persistWrites: (work: () => void) => Promise<void> = async (work) => {
    work();
  },
) => {
  for (const snapshot of await store.list()) {
    if (tables.invoices.state.get(snapshot.invoice.id)) continue;
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
