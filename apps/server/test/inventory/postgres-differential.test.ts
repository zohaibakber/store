import * as PgClient from "@effect/sql-pg/PgClient";
import {
  canonicalJson,
  CommandReceipt,
  ReplicaClientSequence,
  SyncEpoch,
  SyncProtocolError,
  type CatalogRowWrite,
  type InvoiceAllocation,
  type SyncCommand,
  type SyncCommandEnvelope,
} from "@store/contracts";
import {
  decodeBatchId,
  decodeCategoryId,
  decodeInvoiceId,
  decodeInvoiceItemId,
  decodeProductId,
} from "@store/contracts/ids";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  LAST_UNIT_REPLICA_B,
  lastUnitBuyerAEnvelope,
  lastUnitBuyerBEnvelope,
} from "@store/contracts/sync/fixtures";
import {
  batches,
  categories,
  commandReceipts,
  inventoryChanges,
  inventoryState,
  inventoryTransactions,
  invoiceItems,
  invoices,
  products,
  replicas,
  stockMovements,
} from "@store/db/postgres/schema";
import { asc, eq } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeInventoryCommands } from "../../src/inventory/commands";
import type { InventoryActor } from "../../src/inventory/model";
import type { InventoryDrizzle } from "../../src/inventory/postgres";
import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";
import { commitWithOracle } from "./oracle/commit";

const ORGANIZATION_ID = LAST_UNIT_ORGANIZATION_ID;
const OWNER = "user-1";
const STRANGER = "user-2";
const FOREIGN_REPLICA = "replica-c";
const SEEDED_AT = 1_700_000_000_000;
const RECEIVED_AT = 1_700_000_500_000;
const GENERATED_COMMANDS = 600;

const owner: InventoryActor = { organizationId: ORGANIZATION_ID, userId: OWNER };

const isProtocol = Schema.is(SyncProtocolError);

let postgres: AuthorityPostgres;
let oracleUrl: string;
let sqlUrl: string;

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

type Random = {
  readonly chance: (probability: number) => boolean;
  readonly integer: (minimum: number, maximum: number) => number;
  readonly pick: <A>(values: ReadonlyArray<A>) => A | undefined;
};

const randomFrom = (seed: number): Random => {
  const next = mulberry32(seed);
  const integer = (minimum: number, maximum: number) =>
    minimum + Math.floor(next() * (maximum - minimum + 1));
  return {
    chance: (probability) => next() < probability,
    integer,
    pick: (values) => values[integer(0, values.length - 1)],
  };
};

const openDatabase = (url: string) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      PgClient.layer({ url: Redacted.make(url), maxConnections: 2 }),
    );
    return yield* PgDrizzle.makeWithDefaults().pipe(Effect.provideContext(context));
  });

const seedDatabase = (db: InventoryDrizzle) =>
  Effect.gen(function* () {
    const metadata = {
      organizationId: ORGANIZATION_ID,
      createdByUserId: OWNER,
      updatedByUserId: OWNER,
      deviceId: LAST_UNIT_REPLICA_A,
      rowVersion: 1,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    };
    yield* db.insert(inventoryState).values({
      organizationId: ORGANIZATION_ID,
      status: "ready",
      importId: "import-differential",
      releaseId: "release-differential",
      incarnation: "incarnation-differential",
      epoch: LAST_UNIT_EPOCH,
      commitSequence: "0",
      retentionFloor: "0",
    });
    yield* db.insert(categories).values({
      id: "general",
      name: "General",
      tracksPacks: true,
      operationId: "seed-category",
      ...metadata,
    });
    yield* db.insert(products).values({
      id: LAST_UNIT_PRODUCT_ID,
      name: "Last unit",
      categoryId: "general",
      aisle: null,
      composition: null,
      strength: null,
      unitsPerPack: 1,
      purchasePrice: 50,
      retailPrice: 100,
      unitPrice: 100,
      visible: true,
      deletedAt: null,
      operationId: "seed-product",
      ...metadata,
    });
    yield* db.insert(batches).values({
      id: LAST_UNIT_BATCH_ID,
      productId: LAST_UNIT_PRODUCT_ID,
      batchNumber: "B-1",
      expiresAt: null,
      packQuantity: 0,
      unitQuantity: 1,
      deletedAt: null,
      operationId: "seed-batch",
      ...metadata,
    });
    const owners: ReadonlyArray<readonly [string, string]> = [
      [LAST_UNIT_REPLICA_A, OWNER],
      [LAST_UNIT_REPLICA_B, OWNER],
      [FOREIGN_REPLICA, STRANGER],
    ];
    for (const [replicaId, ownerUserId] of owners) {
      yield* db.insert(replicas).values({
        organizationId: ORGANIZATION_ID,
        replicaId,
        ownerUserId,
        deviceLabel: replicaId,
        lastClientSequence: "0",
        processedThroughClientSequence: "0",
        registeredAt: SEEDED_AT,
        lastSeenAt: SEEDED_AT,
      });
    }
  });

const readModel = (db: InventoryDrizzle) =>
  Effect.gen(function* () {
    return {
      categories: yield* db
        .select()
        .from(categories)
        .where(eq(categories.organizationId, ORGANIZATION_ID))
        .orderBy(asc(categories.id)),
      products: yield* db
        .select()
        .from(products)
        .where(eq(products.organizationId, ORGANIZATION_ID))
        .orderBy(asc(products.id)),
      batches: yield* db
        .select()
        .from(batches)
        .where(eq(batches.organizationId, ORGANIZATION_ID))
        .orderBy(asc(batches.id)),
      invoices: yield* db
        .select()
        .from(invoices)
        .where(eq(invoices.organizationId, ORGANIZATION_ID))
        .orderBy(asc(invoices.id)),
      invoiceItems: yield* db
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.organizationId, ORGANIZATION_ID))
        .orderBy(asc(invoiceItems.id)),
      stockMovements: yield* db
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.organizationId, ORGANIZATION_ID))
        .orderBy(asc(stockMovements.id)),
      state: yield* db
        .select()
        .from(inventoryState)
        .where(eq(inventoryState.organizationId, ORGANIZATION_ID)),
      replicas: yield* db
        .select()
        .from(replicas)
        .where(eq(replicas.organizationId, ORGANIZATION_ID))
        .orderBy(asc(replicas.replicaId)),
      transactions: yield* db
        .select()
        .from(inventoryTransactions)
        .where(eq(inventoryTransactions.organizationId, ORGANIZATION_ID))
        .orderBy(asc(inventoryTransactions.commitSequence)),
      changes: yield* db
        .select()
        .from(inventoryChanges)
        .where(eq(inventoryChanges.organizationId, ORGANIZATION_ID))
        .orderBy(asc(inventoryChanges.commitSequence), asc(inventoryChanges.ordinal)),
      receipts: yield* db
        .select()
        .from(commandReceipts)
        .where(eq(commandReceipts.organizationId, ORGANIZATION_ID))
        .orderBy(asc(commandReceipts.operationId)),
    };
  });

type Model = Effect.Success<ReturnType<typeof readModel>>;

type Step = {
  readonly label: string;
  readonly actor: InventoryActor;
  readonly envelope: SyncCommandEnvelope;
};

const envelopeOf = (
  replicaId: string,
  clientSequence: string,
  command: SyncCommand,
  operationId: string = command.payload.commandId,
): SyncCommandEnvelope => ({
  organizationId: ORGANIZATION_ID,
  epoch: SyncEpoch.make(LAST_UNIT_EPOCH),
  replicaId,
  clientSequence: ReplicaClientSequence.make(clientSequence),
  operationId,
  payloadHash: canonicalPayloadHash(command),
  command,
});

const nextSequence = (model: Model, replicaId: string) =>
  String(
    BigInt(model.replicas.find((row) => row.replicaId === replicaId)?.lastClientSequence ?? "0") +
      1n,
  );

const makeGenerator = (random: Random) => {
  let counter = 0;
  const fresh = (prefix: string) => `${prefix}-${(counter += 1)}`;
  const sent: Array<SyncCommandEnvelope> = [];
  const customerNames = [
    null,
    "  Ali  ",
    "\u00a0Sara\u3000",
    "   ",
    "Zo\u00eb \u2028",
    "O'Brien",
    '\u{1f600} Caf\u00e9 \\ "quoted" \u0001\t</script>\u007f',
  ];

  const catalog = (writes: ReadonlyArray<CatalogRowWrite>): SyncCommand => ({
    _tag: "catalogWrite",
    payload: {
      commandId: fresh("catalog"),
      deviceId: LAST_UNIT_REPLICA_A,
      occurredAt: SEEDED_AT + counter * 1_000,
      writes,
    },
  });

  const staleOr = (rowVersion: number) =>
    random.chance(0.75)
      ? rowVersion
      : random.chance(0.5)
        ? rowVersion + 1
        : Math.max(1, rowVersion - 1);

  const categoryInsert = (model: Model): CatalogRowWrite => ({
    entity: "category",
    action: "upsert",
    id: decodeCategoryId(
      random.chance(0.08) ? (random.pick(model.categories)?.id ?? fresh("cat")) : fresh("cat"),
    ),
    expectedRowVersion: null,
    row: {
      name: random.chance(0.15)
        ? (random.pick(model.categories)?.name ?? "General")
        : `Category ${fresh("name")}`,
      tracksPacks: random.chance(0.7),
    },
  });

  const productRow = (model: Model, categoryId: string | undefined) => ({
    name: `Product ${fresh("name")}`,
    categoryId: decodeCategoryId(
      random.chance(0.08)
        ? "cat-missing"
        : (categoryId ?? random.pick(model.categories)?.id ?? "general"),
    ),
    aisle: random.chance(0.5) ? `A${random.integer(1, 9)}` : null,
    composition: random.chance(0.3) ? 'Paracetamol "500" \\ mg' : null,
    strength: random.chance(0.3) ? "500mg" : null,
    unitsPerPack: random.pick([1, 2, 6, 10]) ?? 1,
    purchasePrice: random.chance(0.8) ? random.integer(1, 500) : null,
    retailPrice: random.chance(0.8) ? random.integer(1, 900) : null,
    unitPrice: random.chance(0.8) ? random.integer(1, 90) : null,
    visible: random.chance(0.9),
  });

  const productInsert = (model: Model, categoryId?: string): CatalogRowWrite => ({
    entity: "product",
    action: "upsert",
    id: decodeProductId(
      random.chance(0.05) ? (random.pick(model.products)?.id ?? fresh("prod")) : fresh("prod"),
    ),
    expectedRowVersion: null,
    row: productRow(model, categoryId),
  });

  const movementId = (model: Model) =>
    random.chance(0.05) ? (random.pick(model.stockMovements)?.id ?? fresh("mv")) : fresh("mv");

  const batchInsert = (model: Model, productId?: string): CatalogRowWrite => ({
    entity: "batch",
    action: "upsert",
    id: decodeBatchId(
      random.chance(0.05) ? (random.pick(model.batches)?.id ?? fresh("batch")) : fresh("batch"),
    ),
    expectedRowVersion: null,
    movementId: movementId(model),
    note: random.chance(0.5) ? "Received" : null,
    row: {
      productId: decodeProductId(productId ?? random.pick(model.products)?.id ?? "prod-missing"),
      batchNumber: random.chance(0.8) ? `B-${random.integer(1, 999)}` : null,
      expiresAt: random.chance(0.6) ? SEEDED_AT + random.integer(1, 400) * 86_400_000 : null,
      packQuantity: random.chance(0.2) ? 0 : random.integer(0, 12),
      unitQuantity: random.chance(0.3) ? 0 : random.integer(0, 30),
    },
  });

  const createCatalog = (model: Model): SyncCommand => {
    const writes: Array<CatalogRowWrite> = [];
    const category = random.chance(0.4) ? categoryInsert(model) : undefined;
    if (category) writes.push(category);
    const product = productInsert(model, category?.id);
    writes.push(product);
    const batchCount = random.integer(0, 3);
    for (let index = 0; index < batchCount; index += 1) {
      writes.push(batchInsert(model, product.id));
    }
    return catalog(writes);
  };

  const updateProduct = (model: Model): SyncCommand | undefined => {
    const current = random.pick(model.products);
    if (!current) return undefined;
    const changeUnits = random.chance(0.3);
    return catalog([
      {
        entity: "product",
        action: "upsert",
        id: decodeProductId(current.id),
        expectedRowVersion: random.chance(0.08) ? null : staleOr(current.rowVersion),
        row: {
          name: random.chance(0.5) ? `${current.name} renamed` : current.name,
          categoryId: decodeCategoryId(
            random.chance(0.2)
              ? random.chance(0.3)
                ? "cat-missing"
                : (random.pick(model.categories)?.id ?? current.categoryId)
              : current.categoryId,
          ),
          aisle: current.aisle,
          composition: current.composition,
          strength: current.strength,
          unitsPerPack: changeUnits
            ? current.unitsPerPack + random.integer(1, 5)
            : current.unitsPerPack,
          purchasePrice: current.purchasePrice,
          retailPrice: random.chance(0.5) ? random.integer(1, 900) : current.retailPrice,
          unitPrice: current.unitPrice,
          visible: random.chance(0.9),
        },
      },
    ]);
  };

  const updateBatch = (model: Model): SyncCommand | undefined => {
    const current = random.pick(model.batches);
    if (!current) return undefined;
    return catalog([
      {
        entity: "batch",
        action: "upsert",
        id: decodeBatchId(current.id),
        expectedRowVersion: random.chance(0.05) ? null : staleOr(current.rowVersion),
        movementId: movementId(model),
        note: random.chance(0.5) ? "Stock count" : null,
        row: {
          productId: decodeProductId(
            random.chance(0.1)
              ? (random.pick(model.products)?.id ?? current.productId)
              : current.productId,
          ),
          batchNumber: current.batchNumber,
          expiresAt: current.expiresAt,
          packQuantity: random.chance(0.4) ? current.packQuantity : random.integer(0, 15),
          unitQuantity: random.chance(0.4) ? current.unitQuantity : random.integer(0, 40),
        },
      },
    ]);
  };

  const deleteWrite = (
    entity: "category" | "product" | "batch",
    rows: ReadonlyArray<{ readonly id: string; readonly rowVersion: number }>,
  ): SyncCommand | undefined => {
    const current = random.pick(rows);
    if (!current) return undefined;
    const expectedRowVersion = random.chance(0.85) ? current.rowVersion : current.rowVersion + 1;
    const write: CatalogRowWrite =
      entity === "category"
        ? { entity, action: "delete", id: decodeCategoryId(current.id), expectedRowVersion }
        : entity === "product"
          ? { entity, action: "delete", id: decodeProductId(current.id), expectedRowVersion }
          : { entity, action: "delete", id: decodeBatchId(current.id), expectedRowVersion };
    return catalog([write]);
  };

  const emptyBatches = (model: Model): SyncCommand | undefined => {
    const current = random.pick(model.batches.filter((row) => row.deletedAt === null));
    if (!current) return undefined;
    return catalog([
      {
        entity: "batch",
        action: "upsert",
        id: decodeBatchId(current.id),
        expectedRowVersion: current.rowVersion,
        movementId: fresh("mv-clear"),
        note: "Cleared",
        row: {
          productId: decodeProductId(current.productId),
          batchNumber: current.batchNumber,
          expiresAt: current.expiresAt,
          packQuantity: 0,
          unitQuantity: 0,
        },
      },
      {
        entity: "batch",
        action: "delete",
        id: decodeBatchId(current.id),
        expectedRowVersion: current.rowVersion + 1,
      },
    ]);
  };

  const updateCategory = (model: Model): SyncCommand | undefined => {
    const current = random.pick(model.categories);
    if (!current) return undefined;
    return catalog([
      {
        entity: "category",
        action: "upsert",
        id: decodeCategoryId(current.id),
        expectedRowVersion: random.chance(0.1) ? null : random.integer(1, 5),
        row: {
          name: random.chance(0.2)
            ? (random.pick(model.categories)?.name ?? current.name)
            : `${current.name} ${fresh("v")}`,
          tracksPacks: random.chance(0.5),
        },
      },
    ]);
  };

  const atomicFailure = (model: Model): SyncCommand | undefined => {
    const staleBatch = random.pick(model.batches);
    if (!staleBatch) return undefined;
    const product = productInsert(model, "general");
    return catalog([
      categoryInsert(model),
      product,
      batchInsert(model, product.id),
      {
        entity: "batch",
        action: "upsert",
        id: decodeBatchId(staleBatch.id),
        expectedRowVersion: staleBatch.rowVersion + 7,
        movementId: fresh("mv"),
        note: null,
        row: {
          productId: decodeProductId(staleBatch.productId),
          batchNumber: staleBatch.batchNumber,
          expiresAt: staleBatch.expiresAt,
          packQuantity: staleBatch.packQuantity,
          unitQuantity: staleBatch.unitQuantity + 1,
        },
      },
    ]);
  };

  const bulkImport = (model: Model): SyncCommand => {
    const product = productInsert(model, "general");
    const writes: Array<CatalogRowWrite> = [product];
    for (let index = 0; index < 60; index += 1) writes.push(batchInsert(model, product.id));
    return catalog(writes);
  };

  const invoice = (model: Model): SyncCommand | undefined => {
    const candidates = model.batches.filter(
      (batch) =>
        random.chance(0.05) ||
        (batch.deletedAt === null &&
          model.products.some(
            (product) => product.id === batch.productId && product.deletedAt === null,
          )),
    );
    const lineCount = random.integer(random.chance(0.02) ? 0 : 1, 3);
    const items: Array<{
      productId: ReturnType<typeof decodeProductId>;
      batchId: ReturnType<typeof decodeBatchId> | null;
      quantity: number;
      quantityType: "unit" | "pack";
      salePrice: number;
    }> = [];
    const allocations: Array<InvoiceAllocation> = [];
    const commandId = fresh("sale");
    for (let line = 0; line < lineCount; line += 1) {
      const batch = random.pick(candidates);
      if (!batch) break;
      const product = model.products.find((row) => row.id === batch.productId);
      const quantityType = random.chance(0.3) ? "pack" : "unit";
      const available =
        quantityType === "pack"
          ? batch.packQuantity
          : batch.packQuantity * (product?.unitsPerPack ?? 1) + batch.unitQuantity;
      const quantity = Math.max(1, random.integer(1, Math.max(1, available + 2)));
      const salePrice = random.integer(0, 500);
      const split = quantity > 1 && random.chance(0.15);
      const takes = split
        ? [Math.floor(quantity / 2), quantity - Math.floor(quantity / 2)]
        : [quantity];
      items.push({
        productId: decodeProductId(batch.productId),
        batchId: random.chance(0.2) ? null : decodeBatchId(batch.id),
        quantity,
        quantityType,
        salePrice,
      });
      for (const take of takes) {
        const saleMovementId = fresh("mv-sale");
        allocations.push({
          invoiceItemId: decodeInvoiceItemId(fresh("item")),
          saleMovementId,
          openPackMovementId: random.chance(0.5) ? `${saleMovementId}-open` : null,
          productId: decodeProductId(batch.productId),
          batchId: decodeBatchId(batch.id),
          quantity: take,
          quantityType,
          salePrice: random.chance(0.03) ? salePrice + 1 : salePrice,
          packsOpened: 0,
        });
      }
    }
    if (allocations.length === 0) return undefined;
    const lastNumber = model.invoices.reduce((last, row) => Math.max(last, row.invoiceNumber), 0);
    const reusedInvoice = random.chance(0.04) ? random.pick(model.invoices) : undefined;
    return {
      _tag: "issueInvoice",
      payload: {
        commandId,
        deviceId: LAST_UNIT_REPLICA_B,
        occurredAt: SEEDED_AT + counter * 1_000,
        invoiceId: decodeInvoiceId(reusedInvoice?.id ?? commandId),
        invoiceNumber: random.chance(0.2) ? Math.max(1, lastNumber) : lastNumber + 1,
        input: {
          customerName: random.pick(customerNames) ?? null,
          items: lineCount === 0 ? [] : items,
        },
        allocations,
      },
    };
  };

  const requestFailure = (model: Model, replicaId: string): Step | undefined => {
    const command = createCatalog(model);
    const sequence = nextSequence(model, replicaId);
    const previous = random.pick(sent);
    switch (random.integer(0, 7)) {
      case 0:
        return {
          label: "sequence gap",
          actor: owner,
          envelope: envelopeOf(replicaId, String(BigInt(sequence) + 2n), command),
        };
      case 1:
        return {
          label: "epoch mismatch",
          actor: owner,
          envelope: { ...envelopeOf(replicaId, sequence, command), epoch: SyncEpoch.make("2") },
        };
      case 2:
        return {
          label: "unknown replica",
          actor: owner,
          envelope: envelopeOf("replica-unknown", "1", command),
        };
      case 3:
        return {
          label: "foreign replica",
          actor: owner,
          envelope: envelopeOf(FOREIGN_REPLICA, nextSequence(model, FOREIGN_REPLICA), command),
        };
      case 4:
        return previous === undefined
          ? undefined
          : {
              label: "operation id reuse",
              actor: owner,
              envelope: envelopeOf(previous.replicaId, sequence, command, previous.operationId),
            };
      case 5:
        return previous === undefined
          ? undefined
          : { label: "duplicate retry", actor: owner, envelope: previous };
      case 6:
        return {
          label: "invalid payload hash",
          actor: owner,
          envelope: { ...envelopeOf(replicaId, sequence, command), payloadHash: "0".repeat(64) },
        };
      default:
        return {
          label: "organization mismatch",
          actor: { ...owner, organizationId: "org-other" },
          envelope: envelopeOf(replicaId, sequence, command),
        };
    }
  };

  const next = (model: Model): Step | undefined => {
    const replicaId = random.chance(0.5) ? LAST_UNIT_REPLICA_A : LAST_UNIT_REPLICA_B;
    const roll = random.integer(1, 100);
    if (roll <= 8) return requestFailure(model, replicaId);
    const [label, command]: readonly [string, SyncCommand | undefined] =
      roll <= 30
        ? ["invoice", invoice(model)]
        : roll <= 42
          ? ["create catalog", createCatalog(model)]
          : roll <= 52
            ? ["update product", updateProduct(model)]
            : roll <= 62
              ? ["update batch", updateBatch(model)]
              : roll <= 66
                ? ["delete batch", deleteWrite("batch", model.batches)]
                : roll <= 70
                  ? ["delete product", deleteWrite("product", model.products)]
                  : roll <= 74
                    ? ["delete category", deleteWrite("category", model.categories)]
                    : roll <= 80
                      ? ["update category", updateCategory(model)]
                      : roll <= 86
                        ? ["clear and delete batch", emptyBatches(model)]
                        : roll <= 92
                          ? ["atomic failure", atomicFailure(model)]
                          : roll <= 94
                            ? ["bulk import", bulkImport(model)]
                            : ["invoice", invoice(model)];
    if (command === undefined) return undefined;
    const sequence = nextSequence(model, replicaId);
    const mismatched = random.chance(0.02);
    const envelope = mismatched
      ? envelopeOf(replicaId, sequence, command, fresh("mismatch"))
      : envelopeOf(replicaId, sequence, command);
    sent.push(envelope);
    return { label: mismatched ? `${label} identity mismatch` : label, actor: owner, envelope };
  };

  return { next };
};

type Outcome =
  | { readonly _tag: "receipt"; readonly receipt: CommandReceipt }
  | { readonly _tag: "protocol"; readonly code: string; readonly message: string }
  | { readonly _tag: "defect"; readonly defect: string };

const outcomeOf = (exit: Exit.Exit<CommandReceipt, unknown>): Outcome => {
  if (Exit.isSuccess(exit)) return { _tag: "receipt", receipt: exit.value };
  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isSome(failure) && isProtocol(failure.value)) {
    return { _tag: "protocol", code: failure.value.code, message: failure.value.message };
  }
  return { _tag: "defect", defect: String(Cause.squash(exit.cause)) };
};

const codeOf = (outcome: Outcome): string => {
  switch (outcome._tag) {
    case "protocol":
      return outcome.code;
    case "defect":
      return "defect";
    case "receipt":
      return outcome.receipt.result._tag === "rejected"
        ? outcome.receipt.result.code
        : outcome.receipt.decision;
  }
};

type Comparison = {
  readonly compared: number;
  readonly mismatches: ReadonlyArray<{
    readonly index: number;
    readonly label: string;
    readonly oracle: unknown;
    readonly sql: unknown;
  }>;
  readonly labels: Record<string, number>;
  readonly codes: Record<string, number>;
  readonly oracleModel: Model;
  readonly sqlModel: Model;
};

const tally = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

describe("postgres command differential", () => {
  beforeAll(async () => {
    postgres = await startAuthorityPostgres();
    oracleUrl = postgres.connectionString;
    sqlUrl = await postgres.createDatabase("inventory_sql");
  }, 180_000);

  afterAll(async () => {
    await postgres?.close();
  });

  it("matches the TypeScript executor on receipts, codes, row images, stock and state", async () => {
    const comparison: Comparison = await Effect.runPromise(
      Effect.gen(function* () {
        const oracleDb = yield* openDatabase(oracleUrl);
        const sqlDb = yield* openDatabase(sqlUrl);
        yield* seedDatabase(oracleDb);
        yield* seedDatabase(sqlDb);
        const commands = makeInventoryCommands(sqlDb);
        const mismatches: Array<Comparison["mismatches"][number]> = [];
        const labels: Record<string, number> = {};
        const codes: Record<string, number> = {};
        let compared = 0;

        const runStep = Effect.fn("Differential.runStep")(function* (step: Step) {
          const oracle = outcomeOf(
            yield* Effect.exit(commitWithOracle(oracleDb, step.actor, step.envelope, RECEIVED_AT)),
          );
          const sql = outcomeOf(
            yield* Effect.exit(
              Effect.gen(function* () {
                yield* TestClock.setTime(RECEIVED_AT);
                return yield* commands.commit(step.actor, step.envelope);
              }).pipe(Effect.provide(TestClock.layer())),
            ),
          );
          tally(labels, step.label);
          const code = codeOf(oracle);
          tally(codes, code);
          if (canonicalJson(oracle) !== canonicalJson(sql)) {
            mismatches.push({ index: compared, label: step.label, oracle, sql });
          }
          compared += 1;
        });

        const fixtureA = {
          label: "fixture buyer A",
          actor: owner,
          envelope: lastUnitBuyerAEnvelope,
        };
        const fixtureB = {
          label: "fixture buyer B",
          actor: owner,
          envelope: lastUnitBuyerBEnvelope,
        };
        for (const step of [fixtureA, fixtureB, fixtureA]) yield* runStep(step);

        const generator = makeGenerator(randomFrom(20260928));
        let attempts = 0;
        while (compared < GENERATED_COMMANDS + 3 && attempts < GENERATED_COMMANDS * 3) {
          attempts += 1;
          const step = generator.next(yield* readModel(oracleDb));
          if (step !== undefined) yield* runStep(step);
        }
        return {
          compared,
          mismatches,
          labels,
          codes,
          oracleModel: yield* readModel(oracleDb),
          sqlModel: yield* readModel(sqlDb),
        };
      }).pipe(Effect.scoped),
    );

    expect(comparison.mismatches).toEqual([]);
    expect(comparison.compared).toBeGreaterThanOrEqual(GENERATED_COMMANDS + 3);
    expect(comparison.sqlModel).toEqual(comparison.oracleModel);
    expect(comparison.sqlModel.changes.map((change) => change.rowJson)).toEqual(
      comparison.oracleModel.changes.map((change) => change.rowJson),
    );
    expect(comparison.sqlModel.receipts.map((receipt) => receipt.resultJson)).toEqual(
      comparison.oracleModel.receipts.map((receipt) => receipt.resultJson),
    );
    for (const code of [
      "accepted",
      "INSUFFICIENT_STOCK",
      "ENTITY_CONFLICT",
      "ENTITY_RELATION_INVALID",
      "INVALID_OPERATION",
      "INVOICE_IDENTITY_CONFLICT",
      "COMMAND_IDENTITY_MISMATCH",
      "REPLICA_SEQUENCE_GAP",
      "OPERATION_ID_REUSED",
      "EPOCH_MISMATCH",
      "REPLICA_UNKNOWN",
      "REPLICA_OWNED_BY_OTHER",
      "INVALID_PAYLOAD_HASH",
      "ORGANIZATION_MISMATCH",
    ]) {
      expect(comparison.codes[code] ?? 0, code).toBeGreaterThan(0);
    }
  }, 300_000);
});
