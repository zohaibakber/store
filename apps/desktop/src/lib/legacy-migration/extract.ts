import { allocationsCoverInput } from "@store/contracts";
import { IssueInvoiceCommand, type InvoiceAllocation } from "@store/contracts/store.schema";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  LegacyRow,
  type LegacyArchive,
  type LegacyCrudRow,
  type LegacyUndecodableEntry,
} from "./model";

export type LegacyCrudOp = "PUT" | "PATCH" | "DELETE";

export type LegacyCrudEntry = {
  readonly clientId: number;
  readonly txId: number | null;
  readonly op: LegacyCrudOp;
  readonly table: string;
  readonly rowId: string;
  readonly data: LegacyRow;
  readonly old: LegacyRow | null;
};

export type LegacyCatalogTable = "categories" | "products" | "batches";

export type LegacyRowChange = {
  readonly table: LegacyCatalogTable;
  readonly rowId: string;
  readonly kind: "create" | "patch" | "delete";
  readonly fields: LegacyRow;
  readonly deltas: Readonly<Record<string, number>>;
  readonly entries: ReadonlyArray<LegacyCrudEntry>;
  readonly position: number;
  readonly occurredAt: number | null;
};

export type LegacySaleSource = "crud" | "journal";

export type LegacySale = {
  readonly command: IssueInvoiceCommand;
  readonly sources: ReadonlyArray<LegacySaleSource>;
  readonly legacy: {
    readonly journal: unknown;
    readonly crud: ReadonlyArray<LegacyCrudEntry>;
  };
};

export type LegacyChanges = {
  readonly databaseName: string | null;
  readonly catalog: ReadonlyArray<LegacyRowChange>;
  readonly sales: ReadonlyArray<LegacySale>;
  readonly legacyInvoiceIds: ReadonlySet<string>;
  readonly legacyDatabaseHasInvoices: boolean;
  readonly undecodable: ReadonlyArray<LegacyUndecodableEntry>;
};

const CATALOG_TABLES: ReadonlySet<string> = new Set(["categories", "products", "batches"]);

const isCatalogTable = (table: string): table is LegacyCatalogTable => CATALOG_TABLES.has(table);
const SALE_TABLES: ReadonlySet<string> = new Set(["invoices", "invoice_items", "stock_movements"]);

export const LEGACY_BUSINESS_FIELDS = {
  categories: ["name", "tracksPacks"],
  products: [
    "name",
    "categoryId",
    "aisle",
    "composition",
    "strength",
    "unitsPerPack",
    "purchasePrice",
    "retailPrice",
    "unitPrice",
    "visible",
  ],
  batches: ["productId", "batchNumber", "expiresAt", "packQuantity", "unitQuantity"],
} satisfies Record<LegacyCatalogTable, ReadonlyArray<string>>;

const QUANTITY_FIELDS: ReadonlySet<string> = new Set(["packQuantity", "unitQuantity"]);

const LegacyCrudPayload = Schema.Struct({
  op: Schema.Literals(["PUT", "PATCH", "DELETE"]),
  type: Schema.String,
  id: Schema.NonEmptyString,
  data: Schema.optionalKey(Schema.NullOr(LegacyRow)),
  old: Schema.optionalKey(Schema.NullOr(LegacyRow)),
});

const decodeCrudPayload = Schema.decodeUnknownResult(Schema.fromJsonString(LegacyCrudPayload));

const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

const LegacyInvoicePut = Schema.Struct({
  invoiceNumber: PositiveInt,
  customerName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  operationId: Schema.NonEmptyString,
  deviceId: Schema.NonEmptyString,
  createdAt: PositiveInt,
});

const LegacyInvoiceItemPut = Schema.Struct({
  invoiceId: Schema.NonEmptyString,
  productId: Schema.NonEmptyString,
  batchId: Schema.NonEmptyString,
  quantity: PositiveInt,
  quantityType: Schema.Literals(["unit", "pack"]),
  salePrice: Schema.Natural,
});

const LegacyMovementPut = Schema.Struct({
  type: Schema.String,
  productId: Schema.NonEmptyString,
  batchId: Schema.NonEmptyString,
  invoiceId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  packDelta: Schema.Int,
});

const decodeInvoicePut = Schema.decodeUnknownResult(LegacyInvoicePut);
const decodeInvoiceItemPut = Schema.decodeUnknownResult(LegacyInvoiceItemPut);
const decodeMovementPut = Schema.decodeUnknownResult(LegacyMovementPut);
const decodeIssueInvoiceCommand = Schema.decodeUnknownResult(IssueInvoiceCommand);

const LegacyJournalValue = Schema.Unknown;
type LegacyJournalValue = typeof LegacyJournalValue.Type;
const JournalRecord = Schema.Record(Schema.String, LegacyJournalValue);
const decodeJournalRecord = Schema.decodeUnknownResult(Schema.fromJsonString(JournalRecord));
const decodeJournalEntry = Schema.decodeUnknownResult(
  Schema.Struct({ command: IssueInvoiceCommand }),
);

const PositiveTimestamp = Schema.decodeUnknownOption(PositiveInt);
const decodeLegacyRowId = Schema.decodeUnknownOption(Schema.Struct({ id: Schema.String }));

type Decoded<A> =
  | { readonly _tag: "ok"; readonly value: A }
  | { readonly _tag: "invalid"; readonly message: string };

const invalid = <A>(message: string): Decoded<A> => ({ _tag: "invalid", message });
const ok = <A>(value: A): Decoded<A> => ({ _tag: "ok", value });

const fromResult = <A>(result: Result.Result<A, Schema.SchemaError>): Decoded<A> =>
  Result.isSuccess(result) ? ok(result.success) : invalid(result.failure.message);

export const decodeLegacyCrudRows = (rows: ReadonlyArray<LegacyCrudRow>) => {
  const entries: Array<LegacyCrudEntry> = [];
  const undecodable: Array<LegacyUndecodableEntry> = [];
  for (const row of [...rows].sort((left, right) => left.id - right.id)) {
    const decoded = decodeCrudPayload(row.data);
    if (Result.isFailure(decoded)) {
      undecodable.push({
        source: "crud",
        reference: String(row.id),
        message: decoded.failure.message,
        raw: row,
      });
      continue;
    }
    entries.push({
      clientId: row.id,
      txId: row.tx_id,
      op: decoded.success.op,
      table: decoded.success.type,
      rowId: decoded.success.id,
      data: decoded.success.data ?? {},
      old: decoded.success.old ?? null,
    });
  }
  return { entries, undecodable };
};

const groupTransactions = (
  entries: ReadonlyArray<LegacyCrudEntry>,
): ReadonlyArray<ReadonlyArray<LegacyCrudEntry>> => {
  const groups: Array<Array<LegacyCrudEntry>> = [];
  let current: Array<LegacyCrudEntry> = [];
  let currentTx: number | null = null;
  for (const entry of entries) {
    if (current.length > 0 && (entry.txId === null || entry.txId !== currentTx)) {
      groups.push(current);
      current = [];
    }
    current.push(entry);
    currentTx = entry.txId;
  }
  if (current.length > 0) groups.push(current);
  return groups;
};

const isSaleGroup = (group: ReadonlyArray<LegacyCrudEntry>) =>
  group.some((entry) => entry.table === "invoices" && entry.op === "PUT");

const saleOwnedEntry = (entry: LegacyCrudEntry) =>
  SALE_TABLES.has(entry.table) || (entry.table === "batches" && entry.op === "PATCH");

export const reconstructLegacySale = (
  crud: ReadonlyArray<LegacyCrudEntry>,
): Decoded<IssueInvoiceCommand> => {
  const invoiceEntry = crud.find((entry) => entry.table === "invoices" && entry.op === "PUT");
  if (!invoiceEntry) return invalid("Queued sale is missing the invoice row.");
  const invoice = fromResult(decodeInvoicePut(invoiceEntry.data));
  if (invoice._tag === "invalid") return invoice;
  const items: Array<typeof LegacyInvoiceItemPut.Type & { readonly id: string }> = [];
  for (const entry of crud) {
    if (entry.table !== "invoice_items" || entry.op !== "PUT") continue;
    const item = fromResult(decodeInvoiceItemPut(entry.data));
    if (item._tag === "invalid") return item;
    items.push({ ...item.value, id: entry.rowId });
  }
  if (items.length === 0) return invalid("Queued sale is missing invoice items.");
  const unused: Array<typeof LegacyMovementPut.Type & { readonly id: string }> = [];
  for (const entry of crud) {
    if (entry.table !== "stock_movements" || entry.op !== "PUT") continue;
    const movement = fromResult(decodeMovementPut(entry.data));
    if (movement._tag === "invalid") return movement;
    unused.push({ ...movement.value, id: entry.rowId });
  }
  const takeMovement = (type: string, item: (typeof items)[number]) => {
    const index = unused.findIndex(
      (movement) =>
        movement.type === type &&
        movement.batchId === item.batchId &&
        movement.productId === item.productId &&
        movement.invoiceId === invoiceEntry.rowId,
    );
    return index < 0 ? undefined : unused.splice(index, 1)[0];
  };
  const allocations: Array<typeof InvoiceAllocation.Encoded> = [];
  for (const item of items) {
    const sale = takeMovement("sale", item);
    const openPack = takeMovement("open_pack", item);
    if (!sale) return invalid("Queued sale is missing a stock movement.");
    allocations.push({
      invoiceItemId: item.id,
      saleMovementId: sale.id,
      openPackMovementId: openPack ? openPack.id : null,
      productId: item.productId,
      batchId: item.batchId,
      quantity: item.quantity,
      quantityType: item.quantityType,
      salePrice: item.salePrice,
      packsOpened: openPack ? Math.abs(openPack.packDelta) : 0,
    });
  }
  const command = fromResult(
    decodeIssueInvoiceCommand({
      commandId: invoice.value.operationId,
      deviceId: invoice.value.deviceId,
      occurredAt: invoice.value.createdAt,
      invoiceId: invoiceEntry.rowId,
      invoiceNumber: invoice.value.invoiceNumber,
      input: {
        customerName: invoice.value.customerName ?? null,
        items: allocations.map((take) => ({
          productId: take.productId,
          batchId: take.batchId,
          quantity: take.quantity,
          quantityType: take.quantityType,
          salePrice: take.salePrice,
        })),
      },
      allocations,
    }),
  );
  if (command._tag === "invalid") return command;
  if (!allocationsCoverInput(command.value.input, command.value.allocations)) {
    return invalid("Queued sale allocations do not match the invoice items.");
  }
  return command;
};

const businessFields = (table: LegacyCatalogTable, row: LegacyRow): LegacyRow => {
  const fields: ReadonlyArray<string> = LEGACY_BUSINESS_FIELDS[table];
  return Object.fromEntries(
    fields.filter((field) => Object.hasOwn(row, field)).map((field) => [field, row[field]]),
  );
};

const isDeletion = (entry: LegacyCrudEntry) =>
  entry.op === "DELETE" ||
  (entry.op === "PATCH" &&
    entry.data["deletedAt"] !== undefined &&
    entry.data["deletedAt"] !== null);

const isFiniteNumber = Schema.is(Schema.Finite);

const occurredAtOf = (entry: LegacyCrudEntry): number | null => {
  const stamp = PositiveTimestamp(entry.data["updatedAt"] ?? entry.data["createdAt"]);
  return stamp._tag === "Some" ? stamp.value : null;
};

type MutableRowChange = {
  table: LegacyCatalogTable;
  rowId: string;
  kind: "create" | "patch" | "delete";
  fields: LegacyRow;
  deltas: Readonly<Record<string, number>>;
  absolute: Set<string>;
  entries: Array<LegacyCrudEntry>;
  first: number;
  last: number;
  occurredAt: number | null;
};

const applyEntry = (change: MutableRowChange, entry: LegacyCrudEntry) => {
  change.entries.push(entry);
  change.last = entry.clientId;
  change.occurredAt = occurredAtOf(entry) ?? change.occurredAt;
  if (isDeletion(entry)) {
    change.kind = "delete";
    return;
  }
  const fields = businessFields(change.table, entry.data);
  if (entry.op === "PUT") {
    change.kind = "create";
    change.fields = { ...fields };
    change.deltas = {};
    change.absolute = new Set(Object.keys(fields));
    return;
  }
  if (change.kind === "delete") change.kind = "patch";
  change.fields = { ...change.fields, ...fields };
  for (const [field, value] of Object.entries(fields)) {
    if (!QUANTITY_FIELDS.has(field) || change.kind === "create" || change.absolute.has(field)) {
      continue;
    }
    const previous = entry.old?.[field];
    if (isFiniteNumber(value) && isFiniteNumber(previous)) {
      change.deltas = {
        ...change.deltas,
        [field]: (change.deltas[field] ?? 0) + (value - previous),
      };
    } else {
      change.absolute.add(field);
    }
  }
};

export const collapseCatalogEntries = (
  entries: ReadonlyArray<LegacyCrudEntry>,
): ReadonlyArray<LegacyRowChange> => {
  const changes = new Map<string, MutableRowChange>();
  for (const entry of entries) {
    const table = entry.table;
    if (!isCatalogTable(table)) continue;
    const key = `${table}:${entry.rowId}`;
    const existing = changes.get(key);
    const change: MutableRowChange = existing ?? {
      table,
      rowId: entry.rowId,
      kind: "patch",
      fields: {},
      deltas: {},
      absolute: new Set(),
      entries: [],
      first: entry.clientId,
      last: entry.clientId,
      occurredAt: null,
    };
    applyEntry(change, entry);
    changes.set(key, change);
  }
  return [...changes.values()]
    .map((change): LegacyRowChange => ({
      table: change.table,
      rowId: change.rowId,
      kind: change.kind,
      fields: change.fields,
      deltas: Object.fromEntries(
        Object.entries(change.deltas).filter(([field]) => !change.absolute.has(field)),
      ),
      entries: change.entries,
      position: change.kind === "delete" ? change.last : change.first,
      occurredAt: change.occurredAt,
    }))
    .sort((left, right) => left.position - right.position);
};

type LegacyJournalSale = {
  readonly command: IssueInvoiceCommand;
  readonly raw: LegacyJournalValue;
};

const decodeJournal = (captures: LegacyArchive["saleOutbox"]) => {
  const sales: Array<LegacyJournalSale> = [];
  const undecodable: Array<LegacyUndecodableEntry> = [];
  for (const capture of captures) {
    const record = decodeJournalRecord(capture.value);
    if (Result.isFailure(record)) {
      undecodable.push({
        source: "saleOutbox",
        reference: capture.key,
        message: record.failure.message,
        raw: capture.value,
      });
      continue;
    }
    for (const [commandId, raw] of Object.entries(record.success)) {
      const entry = decodeJournalEntry(raw);
      if (Result.isFailure(entry)) {
        undecodable.push({
          source: "saleOutbox",
          reference: `${capture.key}/${commandId}`,
          message: entry.failure.message,
          raw,
        });
        continue;
      }
      sales.push({ command: entry.success.command, raw });
    }
  }
  return { sales, undecodable };
};

export const extractLegacyChanges = (archive: LegacyArchive): LegacyChanges => {
  const database = archive.databases[0];
  const crud = decodeLegacyCrudRows(database?.crud ?? []);
  const undecodable: Array<LegacyUndecodableEntry> = [...crud.undecodable];
  const catalogEntries: Array<LegacyCrudEntry> = [];
  const crudSales = new Map<string, LegacySale>();

  for (const group of groupTransactions(crud.entries)) {
    if (!isSaleGroup(group)) {
      for (const entry of group) {
        if (isCatalogTable(entry.table)) {
          catalogEntries.push(entry);
        } else {
          undecodable.push({
            source: "crud",
            reference: String(entry.clientId),
            message: `Unsupported queued write to ${entry.table}.`,
            raw: entry,
          });
        }
      }
      continue;
    }
    const saleEntries = group.filter(saleOwnedEntry);
    catalogEntries.push(...group.filter((entry) => !saleOwnedEntry(entry)));
    const command = reconstructLegacySale(saleEntries);
    if (command._tag === "invalid") {
      undecodable.push({
        source: "sale",
        reference: String(saleEntries[0]?.clientId ?? group[0]?.clientId ?? 0),
        message: command.message,
        raw: saleEntries,
      });
      continue;
    }
    crudSales.set(command.value.invoiceId, {
      command: command.value,
      sources: ["crud"],
      legacy: { journal: null, crud: saleEntries },
    });
  }

  const journal = decodeJournal(archive.saleOutbox);
  undecodable.push(...journal.undecodable);
  const sales = new Map(crudSales);
  for (const entry of journal.sales) {
    const queued = sales.get(entry.command.invoiceId);
    sales.set(entry.command.invoiceId, {
      command: entry.command,
      sources: queued ? ["crud", "journal"] : ["journal"],
      legacy: { journal: entry.raw, crud: queued?.legacy.crud ?? [] },
    });
  }

  const legacyInvoices = database?.tables["invoices"] ?? [];
  const legacyInvoiceIds = new Set(
    legacyInvoices.flatMap((row) =>
      Option.toArray(decodeLegacyRowId(row)).map((decoded) => decoded.id),
    ),
  );

  return {
    databaseName: database?.name ?? null,
    catalog: collapseCatalogEntries(catalogEntries),
    sales: [...sales.values()].sort(
      (left, right) =>
        left.command.occurredAt - right.command.occurredAt ||
        left.command.invoiceId.localeCompare(right.command.invoiceId),
    ),
    legacyInvoiceIds,
    legacyDatabaseHasInvoices: legacyInvoices.length > 0,
    undecodable,
  };
};
