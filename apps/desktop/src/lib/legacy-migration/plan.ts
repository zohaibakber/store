import {
  projectCreateBatch,
  projectCreateCategory,
  projectCreateProduct,
  projectDeleteBatch,
  projectDeleteCategory,
  projectDeleteProduct,
  projectUpdateBatch,
  projectUpdateCategory,
  projectUpdateProduct,
  type BatchRow,
  type CatalogProjectionContext,
  type CatalogProjectionTables,
  type CategoryRow,
  type ProductRow,
} from "@store/client-db";
import type { SyncCommand } from "@store/contracts";
import { canonicalJson } from "@store/contracts/canonical-json";
import type { CatalogRowWrite } from "@store/contracts/catalog-write";
import { CategoryId, ProductId } from "@store/contracts/ids";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { LegacyChanges, LegacyRowChange, LegacySale } from "./extract";
import type { LegacyOperationKind, LegacyRow } from "./model";

export const LEGACY_CARRY_OVER_NOTE = "Carried over from previous version";

export type LegacyIdentity = {
  readonly organizationId: string;
  readonly userId: string;
  readonly replicaId: string;
};

export type LegacyReplicaSnapshot = {
  readonly categories: ReadonlyArray<CategoryRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly batches: ReadonlyArray<BatchRow>;
  readonly invoiceIds: ReadonlySet<string>;
  readonly invoiceNumbers: ReadonlySet<number>;
  readonly maxInvoiceNumber: number;
};

export type LegacySnapshotNeeds = {
  readonly productIds: ReadonlyArray<string>;
  readonly productCategoryIds: ReadonlyArray<string>;
  readonly batchIds: ReadonlyArray<string>;
  readonly batchProductIds: ReadonlyArray<string>;
  readonly invoiceIds: ReadonlyArray<string>;
  readonly invoiceNumbers: ReadonlyArray<number>;
};

export type LegacyPlanDecision =
  | {
      readonly _tag: "enqueue";
      readonly operationId: string;
      readonly kind: LegacyOperationKind;
      readonly reason: string;
      readonly occurredAt: number;
      readonly command: SyncCommand;
      readonly legacy: unknown;
    }
  | {
      readonly _tag: "queued";
      readonly operationId: string;
      readonly kind: LegacyOperationKind;
      readonly reason: string;
      readonly legacy: unknown;
    }
  | {
      readonly _tag: "skipped";
      readonly operationId: string;
      readonly kind: LegacyOperationKind;
      readonly reason: string;
      readonly message: string | null;
      readonly legacy: unknown;
    };

export type LegacyPlanInput = {
  readonly identity: LegacyIdentity;
  readonly changes: LegacyChanges;
  readonly replica: LegacyReplicaSnapshot;
  readonly queued: ReadonlySet<string>;
  readonly now: number;
};

const legacyId = <Parts>(parts: Parts) => `legacy-${canonicalPayloadHash(parts)}`;

export const legacyCatalogOperationId = (
  identity: LegacyIdentity,
  databaseName: string | null,
  change: Pick<LegacyRowChange, "table" | "rowId" | "entries">,
) =>
  legacyId({
    scope: "tabaaq.legacy-migration",
    version: 1,
    organizationId: identity.organizationId,
    replicaId: identity.replicaId,
    database: databaseName ?? "",
    table: change.table,
    rowId: change.rowId,
    clientId: change.entries[0]?.clientId ?? 0,
  });

const derivedRowIds = (operationId: string) => {
  let next = 0;
  return () => {
    next += 1;
    return legacyId({ operationId, row: next });
  };
};

const legacyCatalogOperationIds = (identity: LegacyIdentity, changes: LegacyChanges) =>
  changes.catalog.map((change) => legacyCatalogOperationId(identity, changes.databaseName, change));

export const legacyOperationIds = (identity: LegacyIdentity, changes: LegacyChanges) => [
  ...legacyCatalogOperationIds(identity, changes),
  ...changes.sales.map((sale) => sale.command.commandId),
];

const flagged = (row: LegacyRow, fields: ReadonlyArray<string>): LegacyRow =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) =>
      fields.includes(key) && (value === 0 || value === 1) ? [key, value === 1] : [key, value],
    ),
  );

const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

const CategoryFields = Schema.Struct({
  name: Schema.optionalKey(Schema.NonEmptyString),
  tracksPacks: Schema.optionalKey(Schema.Boolean),
});

const ProductFields = Schema.Struct({
  name: Schema.optionalKey(Schema.NonEmptyString),
  categoryId: Schema.optionalKey(CategoryId),
  aisle: Schema.optionalKey(Schema.NullOr(Schema.String)),
  composition: Schema.optionalKey(Schema.NullOr(Schema.String)),
  strength: Schema.optionalKey(Schema.NullOr(Schema.String)),
  unitsPerPack: Schema.optionalKey(PositiveInt),
  purchasePrice: Schema.optionalKey(Schema.NullOr(Schema.Natural)),
  retailPrice: Schema.optionalKey(Schema.NullOr(Schema.Natural)),
  unitPrice: Schema.optionalKey(Schema.NullOr(Schema.Natural)),
  visible: Schema.optionalKey(Schema.Boolean),
});

const BatchFields = Schema.Struct({
  productId: Schema.optionalKey(ProductId),
  batchNumber: Schema.optionalKey(Schema.NullOr(Schema.String)),
  expiresAt: Schema.optionalKey(Schema.NullOr(Schema.Natural)),
  packQuantity: Schema.optionalKey(Schema.Natural),
  unitQuantity: Schema.optionalKey(Schema.Natural),
});

const decodeCategoryFields = Schema.decodeUnknownSync(CategoryFields);
const decodeProductFields = Schema.decodeUnknownSync(ProductFields);
const decodeBatchFields = Schema.decodeUnknownSync(BatchFields);
const decodeBatchFieldsOption = Schema.decodeUnknownOption(BatchFields);

export const legacySnapshotNeeds = (changes: LegacyChanges): LegacySnapshotNeeds => {
  const productIds = new Set<string>();
  const productCategoryIds = new Set<string>();
  const batchIds = new Set<string>();
  const batchProductIds = new Set<string>();
  for (const change of changes.catalog) {
    switch (change.table) {
      case "categories":
        if (change.kind === "delete") productCategoryIds.add(change.rowId);
        break;
      case "products":
        productIds.add(change.rowId);
        if (change.kind === "delete" || change.fields["unitsPerPack"] !== undefined) {
          batchProductIds.add(change.rowId);
        }
        break;
      case "batches": {
        batchIds.add(change.rowId);
        const fields = decodeBatchFieldsOption(change.fields);
        if (fields._tag === "Some" && fields.value.productId !== undefined) {
          productIds.add(fields.value.productId);
        }
        break;
      }
    }
  }
  return {
    productIds: [...productIds],
    productCategoryIds: [...productCategoryIds],
    batchIds: [...batchIds],
    batchProductIds: [...batchProductIds],
    invoiceIds: changes.sales.map((sale) => sale.command.invoiceId),
    invoiceNumbers: [...new Set(changes.sales.map((sale) => sale.command.invoiceNumber))],
  };
};

type WorkingTables = CatalogProjectionTables & {
  readonly categoryRows: Map<string, CategoryRow>;
  readonly productRows: Map<string, ProductRow>;
  readonly batchRows: Map<string, BatchRow>;
};

const workingTables = (snapshot: LegacyReplicaSnapshot): WorkingTables => {
  const categoryRows = new Map<string, CategoryRow>(
    snapshot.categories.map((row) => [row.id, row]),
  );
  const productRows = new Map<string, ProductRow>(snapshot.products.map((row) => [row.id, row]));
  const batchRows = new Map<string, BatchRow>(snapshot.batches.map((row) => [row.id, row]));
  return {
    categoryRows,
    productRows,
    batchRows,
    categories: {
      state: { get: (id) => categoryRows.get(id), values: () => categoryRows.values() },
    },
    products: { state: { get: (id) => productRows.get(id), values: () => productRows.values() } },
    batches: { state: { get: (id) => batchRows.get(id), values: () => batchRows.values() } },
  };
};

type CatalogOutcome =
  | { readonly _tag: "writes"; readonly writes: ReadonlyArray<CatalogRowWrite> }
  | { readonly _tag: "skip"; readonly reason: string; readonly message: string | null };

const skip = (reason: string, message: string | null = null): CatalogOutcome => ({
  _tag: "skip",
  reason,
  message,
});

const writes = (projected: ReadonlyArray<CatalogRowWrite>): CatalogOutcome =>
  projected.length === 0 ? skip("noChanges") : { _tag: "writes", writes: projected };

const unchanged = <Fields extends object>(current: Fields, next: Fields) =>
  canonicalJson(current) === canonicalJson(next);

const categoryFields = (row: CategoryRow) => ({ name: row.name, tracksPacks: row.tracksPacks });

const productFields = (row: ProductRow) => ({
  name: row.name,
  categoryId: row.categoryId,
  aisle: row.aisle,
  composition: row.composition,
  strength: row.strength,
  unitsPerPack: row.unitsPerPack,
  purchasePrice: row.purchasePrice,
  retailPrice: row.retailPrice,
  unitPrice: row.unitPrice,
  visible: row.visible,
});

const batchFields = (row: BatchRow) => ({
  batchNumber: row.batchNumber,
  expiresAt: row.expiresAt,
  packQuantity: row.packQuantity,
  unitQuantity: row.unitQuantity,
});

const planCategory = (
  change: LegacyRowChange,
  context: CatalogProjectionContext,
  tables: WorkingTables,
  remap: Map<string, CategoryId>,
): CatalogOutcome => {
  const current = tables.categoryRows.get(change.rowId);
  if (change.kind === "delete") {
    if (!current) return skip("rowMissing");
    const projected = projectDeleteCategory(context, current.id);
    tables.categoryRows.delete(current.id);
    return writes(projected.writes);
  }
  const fields = decodeCategoryFields(flagged(change.fields, ["tracksPacks"]));
  if (!current) {
    if (change.kind !== "create") return skip("rowMissing");
    if (fields.name === undefined) return skip("invalid", "The category has no name.");
    const projected = projectCreateCategory(context, {
      id: change.rowId,
      name: fields.name,
      tracksPacks: fields.tracksPacks ?? true,
    });
    if (projected.row.id !== change.rowId) {
      remap.set(change.rowId, projected.row.id);
      return skip("duplicateName", `Merged into existing category ${projected.row.id}.`);
    }
    tables.categoryRows.set(projected.row.id, projected.row);
    return writes(projected.writes);
  }
  const next = {
    name: fields.name ?? current.name,
    tracksPacks: fields.tracksPacks ?? current.tracksPacks,
  };
  if (unchanged(categoryFields(current), next)) return skip("noChanges");
  const projected = projectUpdateCategory(context, { id: current.id, ...next });
  tables.categoryRows.set(projected.row.id, projected.row);
  return writes(projected.writes);
};

const planProduct = (
  change: LegacyRowChange,
  context: CatalogProjectionContext,
  tables: WorkingTables,
  remap: Map<string, CategoryId>,
): CatalogOutcome => {
  const current = tables.productRows.get(change.rowId);
  if (change.kind === "delete") {
    if (!current) return skip("rowMissing");
    const projected = projectDeleteProduct(context, current.id);
    tables.productRows.delete(current.id);
    return writes(projected.writes);
  }
  const decoded = decodeProductFields(flagged(change.fields, ["visible"]));
  const fields =
    decoded.categoryId === undefined
      ? decoded
      : { ...decoded, categoryId: remap.get(decoded.categoryId) ?? decoded.categoryId };
  if (!current) {
    if (change.kind !== "create") return skip("rowMissing");
    if (fields.name === undefined) return skip("invalid", "The product has no name.");
    const projected = projectCreateProduct(context, {
      ...fields,
      id: change.rowId,
      name: fields.name,
    });
    tables.productRows.set(projected.row.id, projected.row);
    return writes(projected.writes);
  }
  const next = {
    name: fields.name ?? current.name,
    categoryId: fields.categoryId ?? current.categoryId,
    aisle: fields.aisle === undefined ? current.aisle : fields.aisle,
    composition: fields.composition === undefined ? current.composition : fields.composition,
    strength: fields.strength === undefined ? current.strength : fields.strength,
    unitsPerPack: fields.unitsPerPack ?? current.unitsPerPack,
    purchasePrice:
      fields.purchasePrice === undefined ? current.purchasePrice : fields.purchasePrice,
    retailPrice: fields.retailPrice === undefined ? current.retailPrice : fields.retailPrice,
    unitPrice: fields.unitPrice === undefined ? current.unitPrice : fields.unitPrice,
    visible: fields.visible ?? current.visible,
  };
  if (unchanged(productFields(current), next)) return skip("noChanges");
  const projected = projectUpdateProduct(context, { id: current.id, ...next });
  tables.productRows.set(projected.row.id, projected.row);
  return writes(projected.writes);
};

const quantityOf = (
  change: LegacyRowChange,
  field: "packQuantity" | "unitQuantity",
  absolute: number | undefined,
  current: number,
) => {
  const delta = change.deltas[field];
  if (delta !== undefined) return Math.max(0, current + delta);
  return absolute ?? current;
};

const planBatch = (
  change: LegacyRowChange,
  context: CatalogProjectionContext,
  tables: WorkingTables,
): CatalogOutcome => {
  const current = tables.batchRows.get(change.rowId);
  if (change.kind === "delete") {
    if (!current) return skip("rowMissing");
    const projected = projectDeleteBatch(context, current.id);
    tables.batchRows.delete(current.id);
    return writes(projected.writes);
  }
  const fields = decodeBatchFields(change.fields);
  if (!current) {
    if (change.kind !== "create") return skip("rowMissing");
    if (fields.productId === undefined) return skip("invalid", "The batch has no product.");
    const projected = projectCreateBatch(context, {
      id: change.rowId,
      productId: fields.productId,
      batchNumber: fields.batchNumber ?? null,
      expiresAt: fields.expiresAt ?? null,
      packQuantity: fields.packQuantity ?? 0,
      unitQuantity: fields.unitQuantity ?? 0,
      note: LEGACY_CARRY_OVER_NOTE,
    });
    tables.batchRows.set(projected.row.id, projected.row);
    return writes(projected.writes);
  }
  const next = {
    batchNumber: fields.batchNumber === undefined ? current.batchNumber : fields.batchNumber,
    expiresAt: fields.expiresAt === undefined ? current.expiresAt : fields.expiresAt,
    packQuantity: quantityOf(change, "packQuantity", fields.packQuantity, current.packQuantity),
    unitQuantity: quantityOf(change, "unitQuantity", fields.unitQuantity, current.unitQuantity),
  };
  if (unchanged(batchFields(current), next)) return skip("noChanges");
  const projected = projectUpdateBatch(context, {
    id: current.id,
    ...next,
    note: LEGACY_CARRY_OVER_NOTE,
  });
  tables.batchRows.set(projected.row.id, projected.row);
  return writes(projected.writes);
};

const catalogLegacy = (change: LegacyRowChange) => ({
  table: change.table,
  rowId: change.rowId,
  kind: change.kind,
  entries: change.entries,
});

const failureMessage = (cause: unknown) =>
  cause instanceof Error && cause.message ? cause.message : String(cause);

const planCatalog = (
  input: LegacyPlanInput,
  tables: WorkingTables,
  remap: Map<string, CategoryId>,
  change: LegacyRowChange,
): LegacyPlanDecision => {
  const operationId = legacyCatalogOperationId(input.identity, input.changes.databaseName, change);
  const legacy = catalogLegacy(change);
  if (input.queued.has(operationId)) {
    return { _tag: "queued", operationId, kind: "catalog", reason: "alreadyQueued", legacy };
  }
  const occurredAt = change.occurredAt ?? input.now;
  const context: CatalogProjectionContext = {
    actor: {
      organizationId: input.identity.organizationId,
      userId: input.identity.userId,
      deviceId: input.identity.replicaId,
    },
    commandId: operationId,
    occurredAt,
    ids: {
      now: () => occurredAt,
      operationId: () => operationId,
      rowId: derivedRowIds(operationId),
    },
    tables,
  };
  const outcome = Result.try({
    try: () => {
      switch (change.table) {
        case "categories":
          return planCategory(change, context, tables, remap);
        case "products":
          return planProduct(change, context, tables, remap);
        case "batches":
          return planBatch(change, context, tables);
      }
    },
    catch: (cause) => skip("invalid", failureMessage(cause)),
  });
  const resolved = Result.isSuccess(outcome) ? outcome.success : outcome.failure;
  if (resolved._tag === "skip") {
    return {
      _tag: "skipped",
      operationId,
      kind: "catalog",
      reason: resolved.reason,
      message: resolved.message,
      legacy,
    };
  }
  return {
    _tag: "enqueue",
    operationId,
    kind: "catalog",
    reason: change.kind,
    occurredAt,
    command: {
      _tag: "catalogWrite",
      payload: {
        commandId: operationId,
        deviceId: input.identity.replicaId,
        occurredAt,
        writes: resolved.writes,
      },
    },
    legacy,
  };
};

const saleLegacy = (sale: LegacySale) => ({
  invoiceId: sale.command.invoiceId,
  sources: sale.sources,
  command: sale.command,
  journal: sale.legacy.journal,
  crud: sale.legacy.crud,
});

const saleReason = (sale: LegacySale, changes: LegacyChanges) => {
  if (sale.sources.includes("crud")) return "unsynced";
  return changes.legacyDatabaseHasInvoices ? "missingFromPreviousVersion" : "unverified";
};

const planSales = (input: LegacyPlanInput): ReadonlyArray<LegacyPlanDecision> => {
  const taken = new Set(input.replica.invoiceNumbers);
  let nextNumber =
    Math.max(
      input.replica.maxInvoiceNumber,
      ...input.changes.sales.map((sale) => sale.command.invoiceNumber),
    ) + 1;
  return input.changes.sales.map((sale): LegacyPlanDecision => {
    const operationId = sale.command.commandId;
    const legacy = saleLegacy(sale);
    if (input.queued.has(operationId)) {
      return { _tag: "queued", operationId, kind: "sale", reason: "alreadyQueued", legacy };
    }
    if (input.replica.invoiceIds.has(sale.command.invoiceId)) {
      return {
        _tag: "skipped",
        operationId,
        kind: "sale",
        reason: "alreadySynced",
        message: null,
        legacy,
      };
    }
    if (
      !sale.sources.includes("crud") &&
      input.changes.legacyInvoiceIds.has(sale.command.invoiceId)
    ) {
      return {
        _tag: "skipped",
        operationId,
        kind: "sale",
        reason: "syncedByPreviousVersion",
        message: null,
        legacy,
      };
    }
    const invoiceNumber = taken.has(sale.command.invoiceNumber)
      ? nextNumber++
      : sale.command.invoiceNumber;
    taken.add(invoiceNumber);
    return {
      _tag: "enqueue",
      operationId,
      kind: "sale",
      reason: saleReason(sale, input.changes),
      occurredAt: sale.command.occurredAt,
      command: { _tag: "issueInvoice", payload: { ...sale.command, invoiceNumber } },
      legacy,
    };
  });
};

export const planLegacyMigration = (input: LegacyPlanInput): ReadonlyArray<LegacyPlanDecision> => {
  const tables = workingTables(input.replica);
  const remap = new Map<string, CategoryId>();
  const catalog = input.changes.catalog.map((change) => planCatalog(input, tables, remap, change));
  return [...catalog, ...planSales(input)];
};
