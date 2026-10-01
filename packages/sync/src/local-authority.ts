import {
  allocationsCoverInput,
  AuthorityIncarnation,
  catalogWriteError,
  CommandReceipt,
  compareDecimalSequence,
  incrementDecimalSequence,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  ReplicaClientSequence,
  STOCK_MOVEMENT_ROW_VERSION,
  SYNC_SCHEMA_VERSION,
  SyncEpoch,
  SyncProtocolError,
  syncProtocolError,
  type CatalogRowWrite,
  type RegisterReplicaRequest,
  type RegisterReplicaResult,
  type SyncCommand,
  type SyncCommandEnvelope,
  type SyncEntity,
  type SyncLogChange,
  type SyncProtocolCode,
  type SyncPullRequest,
  type SyncPullResult,
  type SyncSubmitCommandRequest,
  type SyncSubmitCommandResult,
  type SyncTransactionGroup,
} from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  ReplicaBatchRow,
  ReplicaCategoryRow,
  ReplicaInvoiceItemRow,
  ReplicaInvoiceRow,
  ReplicaProductRow,
  ReplicaStockMovementRow,
} from "@store/contracts/sync/replica-model";
import {
  batches,
  categories,
  commandOutbox,
  invoices,
  pendingRowJournal,
  products,
} from "@store/db/replica.schema";
import { and, count, desc, eq, gt, inArray, notExists, or, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import { QueryBuilder, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { decodeStoredEnvelope } from "./replica/codecs";
import { loadReplicaState } from "./replica/commands";
import {
  projectCommand,
  type ProjectedRow,
  type ProjectionActor,
  type ReplicaCatalogLookup,
} from "./replica/projection";
import type { ReplicaDb } from "./replica/sql-client/drizzle";
import {
  runReplicaTransaction,
  SqliteReplica,
  type SqliteReplicaHandle,
} from "./replica/sql-client/handle";
import {
  SyncTransportService,
  SyncTransportUnavailable,
  SyncTransportUndecodable,
  type SyncTransport,
  type SyncTransportError,
} from "./transport";

export const LOCAL_AUTHORITY_EPOCH = SyncEpoch.make("1");

const INT4_MAX = 2_147_483_647;

const RETRY_MILLIS = 1_000;

const IDS_PER_QUERY = 400;

type CatalogPayload = Extract<SyncCommand, { readonly _tag: "catalogWrite" }>["payload"];

type InvoicePayload = Extract<SyncCommand, { readonly _tag: "issueInvoice" }>["payload"];

type InvoiceTake = InvoicePayload["allocations"][number];

type ProjectedUpsert = Exclude<ProjectedRow, { readonly row: null }>;

type AcceptedResult = Exclude<CommandReceipt["result"], { readonly _tag: "rejected" }>;

type Rejection = {
  readonly code: SyncProtocolCode;
  readonly message: string;
};

type Accepted = {
  readonly result: AcceptedResult;
  readonly changes: ReadonlyArray<SyncLogChange>;
};

type Decision = Result.Result<Accepted, Rejection>;

type LocalCatalogFacts = {
  readonly categories: ReadonlyMap<string, ReplicaCategoryRow>;
  readonly products: ReadonlyMap<string, ReplicaProductRow>;
  readonly batches: ReadonlyMap<string, ReplicaBatchRow>;
  readonly recordedMovementIds: ReadonlySet<string>;
  readonly categoriesHoldingOtherProducts: ReadonlySet<string>;
  readonly productsHoldingOtherStock: ReadonlySet<string>;
};

type LocalInvoiceFacts = {
  readonly products: ReadonlyMap<string, ReplicaProductRow>;
  readonly batches: ReadonlyMap<string, ReplicaBatchRow>;
  readonly invoice: ReplicaInvoiceRow | undefined;
  readonly invoiceNumberTaken: boolean;
  readonly highestInvoiceNumber: number;
  readonly recordedItemIds: ReadonlySet<string>;
  readonly recordedMovementIds: ReadonlySet<string>;
};

const rejected = (code: SyncProtocolCode, message: string): Result.Result<never, Rejection> =>
  Result.fail({ code, message });

const OUT_OF_RANGE = rejected("INVALID_OPERATION", "A value in this command is out of range.");

const ALREADY_EXISTS = rejected("ENTITY_CONFLICT", "A record this command creates already exists.");

const fitsInt4 = (...values: ReadonlyArray<number | null>): boolean =>
  values.every(
    (value) => value === null || (Number.isInteger(value) && Math.abs(value) <= INT4_MAX),
  );

const hasStock = (batch: { readonly packQuantity: number; readonly unitQuantity: number }) =>
  batch.packQuantity > 0 || batch.unitQuantity > 0;

const changeOf = <Row>(
  entity: SyncEntity,
  action: SyncLogChange["action"],
  entityId: string,
  rowVersion: number,
  row: Row,
): SyncLogChange => ({ entity, action, entityId, rowVersion, row });

const upsertOf = (projected: ProjectedUpsert): Result.Result<SyncLogChange, Rejection> => {
  switch (projected.entity) {
    case "category":
      return Result.succeed(
        changeOf("category", "upsert", projected.entityId, projected.row.rowVersion, projected.row),
      );
    case "product": {
      const { row } = projected;
      return fitsInt4(row.unitsPerPack, row.purchasePrice, row.retailPrice, row.unitPrice)
        ? Result.succeed(
            changeOf("product", "upsert", projected.entityId, row.rowVersion, {
              ...row,
              deletedAt: null,
            }),
          )
        : OUT_OF_RANGE;
    }
    case "batch": {
      const { row } = projected;
      return fitsInt4(row.packQuantity, row.unitQuantity)
        ? Result.succeed(
            changeOf("batch", "upsert", projected.entityId, row.rowVersion, {
              ...row,
              deletedAt: null,
            }),
          )
        : OUT_OF_RANGE;
    }
    case "invoice": {
      const { row } = projected;
      return fitsInt4(row.invoiceNumber, row.total) && row.total >= 0
        ? Result.succeed(changeOf("invoice", "upsert", projected.entityId, row.rowVersion, row))
        : OUT_OF_RANGE;
    }
    case "invoiceItem": {
      const { row } = projected;
      return fitsInt4(row.quantity, row.baseUnitQuantity, row.salePrice)
        ? Result.succeed(changeOf("invoiceItem", "upsert", projected.entityId, row.rowVersion, row))
        : OUT_OF_RANGE;
    }
    case "stockMovement": {
      const { row } = projected;
      return fitsInt4(row.packDelta, row.unitDelta)
        ? Result.succeed(
            changeOf(
              "stockMovement",
              "upsert",
              projected.entityId,
              STOCK_MOVEMENT_ROW_VERSION,
              row,
            ),
          )
        : OUT_OF_RANGE;
    }
  }
};

const stampOf = (
  payload: { readonly commandId: string; readonly deviceId: string; readonly occurredAt: number },
  actor: ProjectionActor,
  existing: { readonly rowVersion: number },
) => ({
  updatedByUserId: actor.userId,
  deviceId: payload.deviceId,
  operationId: payload.commandId,
  rowVersion: existing.rowVersion + 1,
  updatedAt: payload.occurredAt,
});

const NO_RULE_LOOKUPS = {
  productInCategory: () => undefined,
  stockedBatchOfProduct: () => undefined,
} satisfies Pick<ReplicaCatalogLookup, "productInCategory" | "stockedBatchOfProduct">;

const decideCatalogWrite = (
  envelope: SyncCommandEnvelope,
  payload: CatalogPayload,
  actor: ProjectionActor,
  facts: LocalCatalogFacts,
): Decision => {
  const staged = {
    categories: new Map<string, ReplicaCategoryRow | undefined>(),
    products: new Map<string, ReplicaProductRow | undefined>(),
    batches: new Map<string, ReplicaBatchRow | undefined>(),
    movements: new Set<string>(),
  };

  const current = <Row>(
    overlay: ReadonlyMap<string, Row | undefined>,
    base: ReadonlyMap<string, Row>,
    id: string,
  ): Row | undefined => (overlay.has(id) ? overlay.get(id) : base.get(id));

  const live = <Row>(
    overlay: ReadonlyMap<string, Row | undefined>,
    base: ReadonlyMap<string, Row>,
  ): ReadonlyArray<Row> =>
    [...new Set([...base.keys(), ...overlay.keys()])].flatMap((id) => {
      const row = current(overlay, base, id);
      return row === undefined ? [] : [row];
    });

  const lookup: ReplicaCatalogLookup = {
    category: (id) => current(staged.categories, facts.categories, id),
    product: (id) => current(staged.products, facts.products, id),
    batch: (id) => current(staged.batches, facts.batches, id),
    ...NO_RULE_LOOKUPS,
  };

  const categoryHoldsProduct = (categoryId: string): boolean =>
    facts.categoriesHoldingOtherProducts.has(categoryId) ||
    live(staged.products, facts.products).some((product) => product.categoryId === categoryId);

  const productHoldsStock = (productId: string): boolean =>
    facts.productsHoldingOtherStock.has(productId) ||
    live(staged.batches, facts.batches).some(
      (batch) => batch.productId === productId && hasStock(batch),
    );

  const record = (projected: ProjectedUpsert): Result.Result<SyncLogChange, Rejection> => {
    switch (projected.entity) {
      case "category":
        staged.categories.set(projected.entityId, projected.row);
        return upsertOf(projected);
      case "product":
        staged.products.set(projected.entityId, projected.row);
        return upsertOf(projected);
      case "batch":
        staged.batches.set(projected.entityId, projected.row);
        return upsertOf(projected);
      case "stockMovement": {
        if (
          facts.recordedMovementIds.has(projected.entityId) ||
          staged.movements.has(projected.entityId)
        ) {
          return rejected("ENTITY_CONFLICT", `Movement ${projected.entityId} is already recorded.`);
        }
        staged.movements.add(projected.entityId);
        return upsertOf(projected);
      }
      case "invoice":
      case "invoiceItem":
        return upsertOf(projected);
    }
  };

  const upsert = (
    write: Extract<CatalogRowWrite, { readonly action: "upsert" }>,
    movementType: "stock_in" | "adjustment" = "stock_in",
  ): Result.Result<ReadonlyArray<SyncLogChange>, Rejection> =>
    Result.gen(function* () {
      const projection = projectCommand(
        {
          ...envelope,
          command: { _tag: "catalogWrite", payload: { ...payload, writes: [write] } },
        },
        actor,
        lookup,
      );
      const changes: Array<SyncLogChange> = [];
      for (const projected of projection.rows) {
        if (projected.row === null) continue;
        changes.push(
          yield* record(
            projected.entity === "stockMovement"
              ? { ...projected, row: { ...projected.row, type: movementType } }
              : projected,
          ),
        );
      }
      return changes;
    });

  const decideWrite = (
    write: CatalogRowWrite,
  ): Result.Result<ReadonlyArray<SyncLogChange>, Rejection> => {
    switch (write.entity) {
      case "category": {
        const existing = lookup.category(write.id);
        switch (write.action) {
          case "delete": {
            if (existing === undefined) {
              return rejected("ENTITY_CONFLICT", `Category ${write.id} is no longer available.`);
            }
            if (write.expectedRowVersion !== existing.rowVersion) {
              return rejected("ENTITY_CONFLICT", `Category ${write.id} changed since it was read.`);
            }
            if (categoryHoldsProduct(write.id)) {
              return rejected("ENTITY_CONFLICT", catalogWriteError.categoryHasProducts);
            }
            staged.categories.set(write.id, undefined);
            return Result.succeed([
              changeOf("category", "delete", write.id, existing.rowVersion + 1, existing),
            ]);
          }
          case "upsert": {
            if (write.expectedRowVersion === null && existing !== undefined) {
              return rejected("ENTITY_CONFLICT", `Category ${write.id} already exists.`);
            }
            if (write.expectedRowVersion !== null && existing === undefined) {
              return rejected("ENTITY_CONFLICT", `Category ${write.id} is no longer available.`);
            }
            if (
              live(staged.categories, facts.categories).some(
                (category) => category.name === write.row.name && category.id !== write.id,
              )
            ) {
              return rejected(
                "ENTITY_CONFLICT",
                `Category name ${write.row.name} is already in use.`,
              );
            }
            return upsert(write);
          }
        }
      }
      case "product": {
        const existing = lookup.product(write.id);
        switch (write.action) {
          case "delete": {
            if (existing === undefined) {
              return rejected("ENTITY_CONFLICT", `Product ${write.id} is no longer available.`);
            }
            if (write.expectedRowVersion !== existing.rowVersion) {
              return rejected("ENTITY_CONFLICT", `Product ${write.id} changed since it was read.`);
            }
            if (productHoldsStock(write.id)) {
              return rejected("ENTITY_CONFLICT", catalogWriteError.productHasStock);
            }
            const image = {
              ...existing,
              ...stampOf(payload, actor, existing),
              deletedAt: payload.occurredAt,
            };
            staged.products.set(write.id, undefined);
            return Result.succeed([
              changeOf("product", "delete", write.id, image.rowVersion, image),
            ]);
          }
          case "upsert": {
            const categoryMissing = lookup.category(write.row.categoryId) === undefined;
            const relationInvalid = rejected(
              "ENTITY_RELATION_INVALID",
              `Category ${write.row.categoryId} is not available in this organization.`,
            );
            if (write.expectedRowVersion === null) {
              if (existing !== undefined) {
                return rejected("ENTITY_CONFLICT", `Product ${write.id} already exists.`);
              }
              return categoryMissing ? relationInvalid : upsert(write);
            }
            if (existing === undefined) {
              return rejected("ENTITY_CONFLICT", `Product ${write.id} is no longer available.`);
            }
            if (write.row.unitsPerPack !== existing.unitsPerPack) {
              if (write.expectedRowVersion !== existing.rowVersion) {
                return rejected(
                  "ENTITY_CONFLICT",
                  `Product ${write.id} changed since units per pack was read.`,
                );
              }
              if (productHoldsStock(write.id)) {
                return rejected("ENTITY_CONFLICT", catalogWriteError.unitsPerPackWithStock);
              }
            }
            return write.row.categoryId !== existing.categoryId && categoryMissing
              ? relationInvalid
              : upsert(write);
          }
        }
      }
      case "batch": {
        const existing = lookup.batch(write.id);
        switch (write.action) {
          case "delete": {
            if (existing === undefined) {
              return rejected("ENTITY_CONFLICT", `Batch ${write.id} is no longer available.`);
            }
            if (write.expectedRowVersion !== existing.rowVersion) {
              return rejected("ENTITY_CONFLICT", `Batch ${write.id} changed since it was read.`);
            }
            if (hasStock(existing)) {
              return rejected("ENTITY_CONFLICT", catalogWriteError.batchHasStock);
            }
            const image = {
              ...existing,
              ...stampOf(payload, actor, existing),
              deletedAt: payload.occurredAt,
            };
            staged.batches.set(write.id, undefined);
            return Result.succeed([changeOf("batch", "delete", write.id, image.rowVersion, image)]);
          }
          case "upsert": {
            if (lookup.product(write.row.productId) === undefined) {
              return rejected(
                "ENTITY_RELATION_INVALID",
                `Product ${write.row.productId} is not available in this organization.`,
              );
            }
            if (write.expectedRowVersion === null) {
              return existing === undefined
                ? upsert(write, "stock_in")
                : rejected("ENTITY_CONFLICT", `Batch ${write.id} already exists.`);
            }
            if (existing === undefined) {
              return rejected("ENTITY_CONFLICT", `Batch ${write.id} is no longer available.`);
            }
            if (write.expectedRowVersion !== existing.rowVersion) {
              return rejected("ENTITY_CONFLICT", `Batch ${write.id} changed since it was read.`);
            }
            return upsert(write, "adjustment");
          }
        }
      }
    }
  };

  return Result.gen(function* () {
    const changes: Array<SyncLogChange> = [];
    for (const write of payload.writes) {
      changes.push(...(yield* decideWrite(write)));
    }
    return {
      result: { _tag: "catalogWrite", rowsWritten: payload.writes.length },
      changes,
    } satisfies Accepted;
  });
};

type InvoicePlan = {
  readonly take: InvoiceTake;
  readonly opened: number;
  readonly batch: ReplicaBatchRow;
};

const decideIssueInvoice = (
  envelope: SyncCommandEnvelope,
  payload: InvoicePayload,
  actor: ProjectionActor,
  facts: LocalInvoiceFacts,
): Decision =>
  Result.gen(function* () {
    if (payload.input.items.length === 0) {
      return yield* rejected("INVALID_OPERATION", "Add at least one item to the sale.");
    }
    if (!allocationsCoverInput(payload.input, payload.allocations)) {
      return yield* rejected("INVALID_OPERATION", "The sale allocations do not match the items.");
    }
    if (facts.invoice !== undefined && facts.invoice.operationId !== payload.commandId) {
      return yield* rejected("INVOICE_IDENTITY_CONFLICT", "This invoice id is already in use.");
    }

    const working = new Map<string, ReplicaBatchRow>();
    const plans: Array<InvoicePlan> = [];
    for (const take of payload.allocations) {
      const product = facts.products.get(take.productId);
      if (product === undefined) {
        return yield* rejected("INSUFFICIENT_STOCK", "One of the products no longer exists.");
      }
      const owned = facts.batches.get(take.batchId);
      const held =
        working.get(take.batchId) ?? (owned?.productId === product.id ? owned : undefined);
      if (held === undefined) {
        return yield* rejected(
          "INSUFFICIENT_STOCK",
          `The selected batch for ${product.name} is gone.`,
        );
      }
      const available =
        take.quantityType === "pack"
          ? held.packQuantity
          : held.packQuantity * product.unitsPerPack + held.unitQuantity;
      if (available < take.quantity) {
        return yield* rejected(
          "INSUFFICIENT_STOCK",
          `Not enough stock for ${product.name}: ${available} available, ${take.quantity} requested.`,
        );
      }
      const opened =
        take.quantityType === "unit"
          ? Math.max(0, Math.ceil((take.quantity - held.unitQuantity) / product.unitsPerPack))
          : 0;
      const packQuantity =
        take.quantityType === "pack"
          ? held.packQuantity - take.quantity
          : held.packQuantity - opened;
      const unitQuantity =
        take.quantityType === "pack"
          ? held.unitQuantity
          : held.unitQuantity + opened * product.unitsPerPack - take.quantity;
      if (packQuantity < 0 || unitQuantity < 0) {
        return yield* rejected("INSUFFICIENT_STOCK", `Not enough stock for ${product.name}.`);
      }
      const remaining = { ...held, packQuantity, unitQuantity };
      working.set(take.batchId, remaining);
      plans.push({
        take,
        opened,
        batch: { ...remaining, ...stampOf(payload, actor, held) },
      });
    }

    const invoiceNumber = facts.invoiceNumberTaken
      ? facts.highestInvoiceNumber + 1
      : payload.invoiceNumber;
    const projection = projectCommand(
      {
        ...envelope,
        command: {
          _tag: "issueInvoice",
          payload: {
            ...payload,
            invoiceNumber,
            allocations: plans.map((plan) => ({ ...plan.take, packsOpened: plan.opened })),
          },
        },
      },
      actor,
      {
        category: () => undefined,
        product: (id) => facts.products.get(id),
        batch: (id) => facts.batches.get(id),
        ...NO_RULE_LOOKUPS,
      },
    );
    const images = new Map<string, ProjectedUpsert>();
    for (const projected of projection.rows) {
      if (projected.row !== null)
        images.set(`${projected.entity}:${projected.entityId}`, projected);
    }
    const created = new Set<string>();
    const create = (
      entity: "invoice" | "invoiceItem" | "stockMovement",
      id: string,
      recorded: boolean,
    ): Result.Result<SyncLogChange, Rejection> =>
      Result.gen(function* () {
        const key = `${entity}:${id}`;
        const projected = images.get(key);
        if (projected === undefined) {
          return yield* rejected("ENTITY_WRITE_FAILED", "The invoice could not be created.");
        }
        const change = yield* upsertOf(projected);
        if (recorded || created.has(key)) return yield* ALREADY_EXISTS;
        created.add(key);
        return change;
      });

    const changes: Array<SyncLogChange> = [
      yield* create("invoice", payload.invoiceId, facts.invoice !== undefined),
    ];
    for (const { take, opened, batch } of plans) {
      const item = yield* create(
        "invoiceItem",
        take.invoiceItemId,
        facts.recordedItemIds.has(take.invoiceItemId),
      );
      changes.push(
        changeOf("batch", "upsert", batch.id, batch.rowVersion, { ...batch, deletedAt: null }),
        item,
      );
      if (opened > 0) {
        const openPackId = take.openPackMovementId ?? `${take.saleMovementId}:open-pack`;
        changes.push(
          yield* create("stockMovement", openPackId, facts.recordedMovementIds.has(openPackId)),
        );
      }
      changes.push(
        yield* create(
          "stockMovement",
          take.saleMovementId,
          facts.recordedMovementIds.has(take.saleMovementId),
        ),
      );
    }
    return {
      result: { _tag: "issueInvoice", invoiceId: payload.invoiceId, invoiceNumber },
      changes,
    } satisfies Accepted;
  });

const queryBuilder = new QueryBuilder();

const chunked = (ids: ReadonlyArray<string>) => Array.chunksOf(ids, IDS_PER_QUERY);

const unjournaled = (entity: SyncEntity, id: SQLiteColumn) =>
  notExists(
    queryBuilder
      .select({ held: sql`1` })
      .from(pendingRowJournal)
      .where(and(eq(pendingRowJournal.entity, entity), eq(pendingRowJournal.entityId, id))),
  );

const earliestPriors = Effect.fn("LocalAuthority.earliestPriors")(function* (
  tx: ReplicaDb,
  entity: SyncEntity,
) {
  const rows = yield* tx
    .select({
      entityId: pendingRowJournal.entityId,
      priorRowJson: pendingRowJournal.priorRowJson,
      clientSequence: commandOutbox.clientSequence,
    })
    .from(pendingRowJournal)
    .innerJoin(commandOutbox, eq(commandOutbox.operationId, pendingRowJournal.operationId))
    .where(eq(pendingRowJournal.entity, entity))
    .all();
  const earliest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const held = earliest.get(row.entityId);
    if (held === undefined || compareDecimalSequence(row.clientSequence, held.clientSequence) < 0) {
      earliest.set(row.entityId, row);
    }
  }
  return earliest;
});

const byId = <Row extends { readonly id: string }>(
  rows: ReadonlyArray<Row>,
): ReadonlyMap<string, Row> => new Map(rows.map((row) => [row.id, row]));

const authoritativeView = <Row extends { readonly id: string }, Encoded>(
  tx: ReplicaDb,
  organizationId: string,
  entity: SyncEntity,
  schema: Schema.Codec<Row, Encoded>,
) =>
  Effect.gen(function* () {
    const table = syncEntityRows[entity].table;
    const decodeStored = Schema.decodeUnknownEffect(Schema.Array(schema));
    const decodePrior = Schema.decodeUnknownEffect(Schema.fromJsonString(schema));
    const priors = yield* earliestPriors(tx, entity);
    const restored = byId(
      yield* Effect.forEach(
        [...priors.values()].flatMap((prior) =>
          prior.priorRowJson === null ? [] : [prior.priorRowJson],
        ),
        (json) => decodePrior(json),
      ),
    );
    const rowsOf = (ids: Iterable<string>) =>
      Effect.gen(function* () {
        const wanted = [...new Set(ids)];
        const stored = yield* Effect.forEach(
          chunked(wanted.filter((id) => !priors.has(id))),
          (chunk) =>
            tx
              .select()
              .from(table)
              .where(and(eq(table.organizationId, organizationId), inArray(table.id, chunk)))
              .all()
              .pipe(Effect.flatMap(decodeStored)),
        );
        return byId([
          ...stored.flat(),
          ...wanted.flatMap((id) => {
            const row = restored.get(id);
            return row === undefined ? [] : [row];
          }),
        ]);
      });
    return {
      restored,
      journaled: (id: string) => priors.has(id),
      rowsOf,
    };
  });

const CountedKeys = Schema.Array(Schema.Struct({ key: Schema.String, total: Schema.Number }));

const decodeCountedKeys = Schema.decodeUnknownEffect(CountedKeys);

const tally = <Row>(
  rows: Iterable<Row>,
  keyOf: (row: Row) => string,
): ReadonlyMap<string, number> => {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(keyOf(row), (totals.get(keyOf(row)) ?? 0) + 1);
  return totals;
};

type WriteReach = {
  readonly categoryIds: ReadonlyArray<string>;
  readonly categoryNames: ReadonlyArray<string>;
  readonly productIds: ReadonlyArray<string>;
  readonly batchIds: ReadonlyArray<string>;
  readonly movementIds: ReadonlyArray<string>;
  readonly deletedCategoryIds: ReadonlyArray<string>;
  readonly stockCheckedProductIds: ReadonlyArray<string>;
};

const NO_REACH: WriteReach = {
  categoryIds: [],
  categoryNames: [],
  productIds: [],
  batchIds: [],
  movementIds: [],
  deletedCategoryIds: [],
  stockCheckedProductIds: [],
};

const reachOf = (write: CatalogRowWrite): WriteReach => {
  switch (write.entity) {
    case "category":
      switch (write.action) {
        case "delete":
          return { ...NO_REACH, categoryIds: [write.id], deletedCategoryIds: [write.id] };
        case "upsert":
          return { ...NO_REACH, categoryIds: [write.id], categoryNames: [write.row.name] };
      }
    case "product":
      switch (write.action) {
        case "delete":
          return { ...NO_REACH, productIds: [write.id], stockCheckedProductIds: [write.id] };
        case "upsert":
          return {
            ...NO_REACH,
            productIds: [write.id],
            stockCheckedProductIds: [write.id],
            categoryIds: [write.row.categoryId],
          };
      }
    case "batch":
      switch (write.action) {
        case "delete":
          return { ...NO_REACH, batchIds: [write.id] };
        case "upsert":
          return {
            ...NO_REACH,
            batchIds: [write.id],
            productIds: [write.row.productId],
            movementIds: [write.movementId],
          };
      }
  }
};

const footprintOf = (payload: CatalogPayload) => {
  const reaches = payload.writes.map(reachOf);
  const union = (pick: (reach: WriteReach) => ReadonlyArray<string>) =>
    new Set(reaches.flatMap(pick));
  return {
    categoryIds: union((reach) => reach.categoryIds),
    categoryNames: union((reach) => reach.categoryNames),
    productIds: union((reach) => reach.productIds),
    batchIds: union((reach) => reach.batchIds),
    movementIds: union((reach) => reach.movementIds),
    deletedCategoryIds: union((reach) => reach.deletedCategoryIds),
    stockCheckedProductIds: union((reach) => reach.stockCheckedProductIds),
  };
};

const loadCatalogFacts = Effect.fn("LocalAuthority.loadCatalogFacts")(function* (
  tx: ReplicaDb,
  organizationId: string,
  payload: CatalogPayload,
) {
  const footprint = footprintOf(payload);
  const categoryView = yield* authoritativeView(tx, organizationId, "category", ReplicaCategoryRow);
  const productView = yield* authoritativeView(tx, organizationId, "product", ReplicaProductRow);
  const batchView = yield* authoritativeView(tx, organizationId, "batch", ReplicaBatchRow);
  const movementView = yield* authoritativeView(
    tx,
    organizationId,
    "stockMovement",
    ReplicaStockMovementRow,
  );

  const namedStored = yield* Effect.forEach(chunked([...footprint.categoryNames]), (chunk) =>
    tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.organizationId, organizationId),
          inArray(categories.name, chunk),
          unjournaled("category", categories.id),
        ),
      )
      .all(),
  );
  const namedRestored = [...categoryView.restored.values()].filter((category) =>
    footprint.categoryNames.has(category.name),
  );
  const categoryRows = yield* categoryView.rowsOf([
    ...footprint.categoryIds,
    ...namedStored.flat().map((category) => category.id),
    ...namedRestored.map((category) => category.id),
  ]);
  const productRows = yield* productView.rowsOf(footprint.productIds);
  const batchRows = yield* batchView.rowsOf(footprint.batchIds);
  const movementRows = yield* movementView.rowsOf(footprint.movementIds);

  const storedProductsByCategory = yield* Effect.forEach(
    chunked([...footprint.deletedCategoryIds]),
    (chunk) =>
      tx
        .select({ key: products.categoryId, total: count() })
        .from(products)
        .where(
          and(
            eq(products.organizationId, organizationId),
            inArray(products.categoryId, chunk),
            unjournaled("product", products.id),
          ),
        )
        .groupBy(products.categoryId)
        .all()
        .pipe(Effect.flatMap(decodeCountedKeys)),
  );
  const loadedProductsByCategory = tally(
    [...productRows.values()].filter((product) => !productView.journaled(product.id)),
    (product) => product.categoryId,
  );
  const restoredProductCategories = new Set<string>(
    [...productView.restored.values()]
      .filter((product) => !footprint.productIds.has(product.id))
      .map((product) => product.categoryId),
  );
  const categoriesHoldingOtherProducts = new Set([
    ...[...footprint.deletedCategoryIds].filter((id) => restoredProductCategories.has(id)),
    ...storedProductsByCategory
      .flat()
      .filter((row) => row.total > (loadedProductsByCategory.get(row.key) ?? 0))
      .map((row) => row.key),
  ]);

  const storedStockByProduct = yield* Effect.forEach(
    chunked([...footprint.stockCheckedProductIds]),
    (chunk) =>
      tx
        .select({ key: batches.productId, total: count() })
        .from(batches)
        .where(
          and(
            eq(batches.organizationId, organizationId),
            inArray(batches.productId, chunk),
            or(gt(batches.packQuantity, 0), gt(batches.unitQuantity, 0)),
            unjournaled("batch", batches.id),
          ),
        )
        .groupBy(batches.productId)
        .all()
        .pipe(Effect.flatMap(decodeCountedKeys)),
  );
  const loadedStockByProduct = tally(
    [...batchRows.values()].filter((batch) => !batchView.journaled(batch.id) && hasStock(batch)),
    (batch) => batch.productId,
  );
  const restoredStockProducts = new Set<string>(
    [...batchView.restored.values()]
      .filter((batch) => !footprint.batchIds.has(batch.id) && hasStock(batch))
      .map((batch) => batch.productId),
  );
  const productsHoldingOtherStock = new Set([
    ...[...footprint.stockCheckedProductIds].filter((id) => restoredStockProducts.has(id)),
    ...storedStockByProduct
      .flat()
      .filter((row) => row.total > (loadedStockByProduct.get(row.key) ?? 0))
      .map((row) => row.key),
  ]);

  return {
    categories: categoryRows,
    products: productRows,
    batches: batchRows,
    recordedMovementIds: new Set(movementRows.keys()),
    categoriesHoldingOtherProducts,
    productsHoldingOtherStock,
  } satisfies LocalCatalogFacts;
});

const loadInvoiceFacts = Effect.fn("LocalAuthority.loadInvoiceFacts")(function* (
  tx: ReplicaDb,
  organizationId: string,
  payload: InvoicePayload,
) {
  const productView = yield* authoritativeView(tx, organizationId, "product", ReplicaProductRow);
  const batchView = yield* authoritativeView(tx, organizationId, "batch", ReplicaBatchRow);
  const invoiceView = yield* authoritativeView(tx, organizationId, "invoice", ReplicaInvoiceRow);
  const itemView = yield* authoritativeView(
    tx,
    organizationId,
    "invoiceItem",
    ReplicaInvoiceItemRow,
  );
  const movementView = yield* authoritativeView(
    tx,
    organizationId,
    "stockMovement",
    ReplicaStockMovementRow,
  );

  const settled = and(
    eq(invoices.organizationId, organizationId),
    unjournaled("invoice", invoices.id),
  );
  const restoredNumbers = [...invoiceView.restored.values()].map(
    (invoice) => invoice.invoiceNumber,
  );
  const storedHolder = yield* tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(settled, eq(invoices.invoiceNumber, payload.invoiceNumber)))
    .limit(1)
    .get();
  const invoiceNumberTaken =
    storedHolder !== undefined || restoredNumbers.includes(payload.invoiceNumber);
  const storedHighest = invoiceNumberTaken
    ? yield* tx
        .select({ invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .where(settled)
        .orderBy(desc(invoices.invoiceNumber))
        .limit(1)
        .get()
    : undefined;

  return {
    products: yield* productView.rowsOf(payload.allocations.map((take) => take.productId)),
    batches: yield* batchView.rowsOf(payload.allocations.map((take) => take.batchId)),
    invoice: (yield* invoiceView.rowsOf([payload.invoiceId])).get(payload.invoiceId),
    invoiceNumberTaken,
    highestInvoiceNumber: Math.max(0, storedHighest?.invoiceNumber ?? 0, ...restoredNumbers),
    recordedItemIds: new Set(
      (yield* itemView.rowsOf(payload.allocations.map((take) => take.invoiceItemId))).keys(),
    ),
    recordedMovementIds: new Set(
      (yield* movementView.rowsOf(
        payload.allocations.flatMap((take) => [
          take.saleMovementId,
          take.openPackMovementId ?? `${take.saleMovementId}:open-pack`,
        ]),
      )).keys(),
    ),
  } satisfies LocalInvoiceFacts;
});

type ReplicaStateRow = Effect.Success<ReturnType<typeof loadReplicaState>>;

const decideCommand = (
  tx: ReplicaDb,
  state: ReplicaStateRow,
  envelope: SyncCommandEnvelope,
): Effect.Effect<Decision, EffectDrizzleQueryError | Schema.SchemaError> => {
  const actor: ProjectionActor = { organizationId: state.organizationId, userId: state.userId };
  if (envelope.command.payload.commandId !== envelope.operationId) {
    return Effect.succeed(
      rejected("COMMAND_IDENTITY_MISMATCH", "The command id must match the envelope operation id."),
    );
  }
  switch (envelope.command._tag) {
    case "issueInvoice": {
      const { payload } = envelope.command;
      return loadInvoiceFacts(tx, state.organizationId, payload).pipe(
        Effect.map((facts) => decideIssueInvoice(envelope, payload, actor, facts)),
      );
    }
    case "catalogWrite": {
      const { payload } = envelope.command;
      return loadCatalogFacts(tx, state.organizationId, payload).pipe(
        Effect.map((facts) => decideCatalogWrite(envelope, payload, actor, facts)),
      );
    }
  }
};

type DecidedGroup = {
  readonly group: SyncTransactionGroup;
  readonly result: CommandReceipt["result"];
};

const groupOf = (
  commitSequence: OrgCommitSequence,
  operationId: string,
  decision: Decision,
): DecidedGroup =>
  Result.match(decision, {
    onSuccess: ({ result, changes }) => ({
      group: { commitSequence, operationId, decision: "accepted", changes },
      result,
    }),
    onFailure: ({ code, message }) => ({
      group: { commitSequence, operationId, decision: "rejected", changes: [] },
      result: { _tag: "rejected", code, message },
    }),
  });

const DECIDED_STATUSES = ["integrated", "accepted_awaiting_integration", "rejected"] as const;

const UNAPPLIED_STATUSES = ["accepted_awaiting_integration", "rejected"] as const;

const clientSequenceLength = sql`length(${commandOutbox.clientSequence})`;

const nextCommitSequence = (state: ReplicaStateRow) =>
  OrgCommitSequence.make(incrementDecimalSequence(state.appliedCommitSequence));

const decidedTail = Effect.fn("LocalAuthority.decidedTail")(function* (
  tx: ReplicaDb,
  state: ReplicaStateRow,
) {
  const latest = yield* Effect.forEach(DECIDED_STATUSES, (status) =>
    tx
      .select({ clientSequence: commandOutbox.clientSequence })
      .from(commandOutbox)
      .where(eq(commandOutbox.status, status))
      .orderBy(desc(clientSequenceLength), desc(commandOutbox.clientSequence))
      .limit(1)
      .get(),
  );
  const unapplied = yield* Effect.forEach(UNAPPLIED_STATUSES, (status) =>
    tx
      .select()
      .from(commandOutbox)
      .where(
        and(
          eq(commandOutbox.status, status),
          eq(commandOutbox.commitSequence, nextCommitSequence(state)),
        ),
      )
      .limit(1)
      .get(),
  );
  return {
    lastClientSequence: latest.reduce(
      (last, row) =>
        row !== undefined && compareDecimalSequence(row.clientSequence, last) > 0
          ? row.clientSequence
          : last,
      "0",
    ),
    unapplied: unapplied.find((row) => row !== undefined),
  };
});

const ReceiptJson = Schema.fromJsonString(CommandReceipt);

const decodeReceiptJson = Schema.decodeUnknownEffect(ReceiptJson);

const decodeIncarnation = Schema.decodeUnknownEffect(AuthorityIncarnation);

const storedReceipt = Effect.fn("LocalAuthority.storedReceipt")(function* (
  tx: ReplicaDb,
  operationId: string,
) {
  const row = yield* tx
    .select({ receiptJson: commandOutbox.receiptJson })
    .from(commandOutbox)
    .where(eq(commandOutbox.operationId, operationId))
    .get();
  return row === undefined || row.receiptJson === null
    ? undefined
    : yield* decodeReceiptJson(row.receiptJson);
});

const incarnationOf = (state: ReplicaStateRow) =>
  decodeIncarnation(state.registeredAt === null ? `local-${state.replicaId}` : state.incarnation);

const pageOf = Effect.fn("LocalAuthority.pageOf")(function* (
  state: ReplicaStateRow,
  afterCommitSequence: OrgCommitSequence,
  transactions: ReadonlyArray<SyncTransactionGroup>,
) {
  const applied = OrgCommitSequence.make(state.appliedCommitSequence);
  const last = transactions.at(-1)?.commitSequence;
  return {
    epoch: LOCAL_AUTHORITY_EPOCH,
    incarnation: yield* incarnationOf(state),
    subscription: OPERATIONAL_SUBSCRIPTION,
    schemaVersion: SYNC_SCHEMA_VERSION,
    transactions,
    nextCommitSequence: last ?? afterCommitSequence,
    horizon: last ?? applied,
    retentionFloor: applied,
  } satisfies SyncPullResult;
});

const unappliedGroup = Effect.fn("LocalAuthority.unappliedGroup")(function* (
  tx: ReplicaDb,
  state: ReplicaStateRow,
  row: typeof commandOutbox.$inferSelect,
) {
  const commitSequence = nextCommitSequence(state);
  const unreproducible = syncProtocolError(
    "ENTITY_WRITE_FAILED",
    "A recorded decision can no longer be reproduced from the local replica.",
  );
  if (row.status === "rejected") {
    return {
      commitSequence,
      operationId: row.operationId,
      decision: "rejected",
      changes: [],
    } satisfies SyncTransactionGroup;
  }
  const envelope = yield* decodeStoredEnvelope(row);
  const { group } = groupOf(
    commitSequence,
    row.operationId,
    yield* decideCommand(tx, state, envelope),
  );
  return group.decision === "accepted" ? group : yield* Effect.fail(unreproducible);
});

const pageAfter = Effect.fn("LocalAuthority.pageAfter")(function* (
  tx: ReplicaDb,
  state: ReplicaStateRow,
  afterCommitSequence: OrgCommitSequence,
) {
  if (afterCommitSequence !== state.appliedCommitSequence) return undefined;
  const { unapplied } = yield* decidedTail(tx, state);
  return yield* pageOf(
    state,
    afterCommitSequence,
    unapplied === undefined ? [] : [yield* unappliedGroup(tx, state, unapplied)],
  );
});

const readFailure = <E>(cause: E): SyncProtocolError | SyncTransportError => {
  if (
    cause instanceof SyncProtocolError ||
    cause instanceof SyncTransportUnavailable ||
    cause instanceof SyncTransportUndecodable
  ) {
    return cause;
  }
  if (cause instanceof Schema.SchemaError) {
    return SyncTransportUndecodable.make({ message: cause.message });
  }
  return SyncTransportUnavailable.make({
    message: cause instanceof Error ? cause.message : "The local replica could not be read.",
    retryAfterMillis: RETRY_MILLIS,
  });
};

const snapshotUnavailable = Effect.fail(
  syncProtocolError("SNAPSHOT_UNAVAILABLE", "A local workspace has no snapshots."),
);

const makeLocalAuthority = (handle: SqliteReplicaHandle): SyncTransport => {
  const reading = <A, E>(run: (tx: ReplicaDb) => Effect.Effect<A, E>) =>
    runReplicaTransaction(handle, run).pipe(Effect.mapError(readFailure));

  const registerReplica = Effect.fn("LocalAuthority.registerReplica")(function* (
    request: RegisterReplicaRequest,
  ) {
    return yield* reading((tx) =>
      Effect.gen(function* () {
        const state = yield* loadReplicaState(tx);
        if (request.replicaId !== state.replicaId) {
          return yield* Effect.fail(
            syncProtocolError("REPLICA_UNKNOWN", "This replica does not own the local workspace."),
          );
        }
        const applied = OrgCommitSequence.make(state.appliedCommitSequence);
        const { lastClientSequence } = yield* decidedTail(tx, state);
        return {
          replicaId: request.replicaId,
          epoch: LOCAL_AUTHORITY_EPOCH,
          incarnation: yield* incarnationOf(state),
          nextClientSequence: ReplicaClientSequence.make(
            incrementDecimalSequence(lastClientSequence),
          ),
          retentionFloor: applied,
          horizon: applied,
          schemaVersion: SYNC_SCHEMA_VERSION,
        } satisfies RegisterReplicaResult;
      }),
    );
  });

  const submitCommand = Effect.fn("LocalAuthority.submitCommand")(function* (
    request: SyncSubmitCommandRequest,
  ) {
    return yield* reading((tx) =>
      Effect.gen(function* () {
        const state = yield* loadReplicaState(tx);
        if (request.organizationId !== state.organizationId) {
          return yield* Effect.fail(
            syncProtocolError(
              "ORGANIZATION_MISMATCH",
              "The command does not belong to the active organization.",
            ),
          );
        }
        if (canonicalPayloadHash(request.command) !== request.payloadHash) {
          return yield* Effect.fail(
            syncProtocolError("INVALID_PAYLOAD_HASH", "The payload hash does not match."),
          );
        }
        if (request.epoch !== LOCAL_AUTHORITY_EPOCH) {
          return yield* Effect.fail(
            syncProtocolError("EPOCH_MISMATCH", "The replica epoch does not match."),
          );
        }
        const receipted = yield* storedReceipt(tx, request.operationId);
        if (receipted !== undefined) {
          if (receipted.payloadHash !== request.payloadHash) {
            return yield* Effect.fail(
              syncProtocolError("OPERATION_ID_REUSED", "The command id was reused."),
            );
          }
          const page = yield* pageAfter(tx, state, request.afterCommitSequence);
          return (
            page === undefined ? receipted : { ...receipted, page }
          ) satisfies SyncSubmitCommandResult;
        }
        if (request.replicaId !== state.replicaId || state.registeredAt === null) {
          return yield* Effect.fail(
            syncProtocolError("REPLICA_UNKNOWN", "This replica is not registered."),
          );
        }
        const tail = yield* decidedTail(tx, state);
        const expected = incrementDecimalSequence(tail.lastClientSequence);
        if (compareDecimalSequence(request.clientSequence, expected) !== 0) {
          return yield* Effect.fail(
            syncProtocolError(
              "REPLICA_SEQUENCE_GAP",
              `Expected client sequence ${expected}, received ${request.clientSequence}.`,
            ),
          );
        }
        if (tail.unapplied !== undefined) {
          return yield* Effect.fail(
            SyncTransportUnavailable.make({
              message: "An earlier decision has not reached the local replica yet.",
              retryAfterMillis: RETRY_MILLIS,
            }),
          );
        }
        const { group, result } = groupOf(
          nextCommitSequence(state),
          request.operationId,
          yield* decideCommand(tx, state, request),
        );
        const receipt = {
          operationId: request.operationId,
          replicaId: request.replicaId,
          clientSequence: request.clientSequence,
          payloadHash: request.payloadHash,
          decision: group.decision,
          commitSequence: group.commitSequence,
          result,
        } satisfies CommandReceipt;
        if (request.afterCommitSequence !== state.appliedCommitSequence) {
          return receipt satisfies SyncSubmitCommandResult;
        }
        return {
          ...receipt,
          page: yield* pageOf(state, request.afterCommitSequence, [group]),
        } satisfies SyncSubmitCommandResult;
      }),
    );
  });

  const getReceipt = Effect.fn("LocalAuthority.getReceipt")(function* (operationId: string) {
    return yield* reading((tx) => storedReceipt(tx, operationId));
  });

  const pull = Effect.fn("LocalAuthority.pull")(function* (request: SyncPullRequest) {
    return yield* reading((tx) =>
      Effect.gen(function* () {
        const state = yield* loadReplicaState(tx);
        if (request.epoch !== LOCAL_AUTHORITY_EPOCH) {
          return yield* Effect.fail(
            syncProtocolError("EPOCH_MISMATCH", "The replica epoch does not match."),
          );
        }
        const page = yield* pageAfter(tx, state, request.afterCommitSequence);
        return page === undefined
          ? yield* Effect.fail(
              syncProtocolError(
                "SNAPSHOT_REQUIRED",
                "The local authority keeps no history outside the replica's own position.",
              ),
            )
          : page;
      }),
    );
  });

  return {
    registerReplica,
    submitCommand,
    getReceipt,
    pull,
    acquireSnapshot: () => snapshotUnavailable,
    readSnapshotPart: () => snapshotUnavailable,
  };
};

export const LocalAuthority = {
  make: makeLocalAuthority,
  layer: Layer.effect(
    SyncTransportService,
    SqliteReplica.use((handle) => Effect.succeed(makeLocalAuthority(handle))),
  ),
};
