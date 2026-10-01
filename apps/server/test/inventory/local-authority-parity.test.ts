import * as PgClient from "@effect/sql-pg/PgClient";
import {
  catalogWriteError,
  OPERATIONAL_SUBSCRIPTION,
  OrgCommitSequence,
  PARTITION_DIGEST_VERSION,
  ReplicaClientSequence,
  type CatalogRowWrite,
  type CommandReceipt,
  type EnqueueCommandRequest,
  type SyncCommand,
  type SyncSubmitCommandRequest,
  type SyncSubmitCommandResult,
} from "@store/contracts";
import {
  decodeBatchId,
  decodeCategoryId,
  decodeInvoiceId,
  decodeInvoiceItemId,
  decodeOrganizationId,
  decodeProductId,
  type OrganizationId,
} from "@store/contracts/ids";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  lastUnitBuyerACommand,
  lastUnitBuyerBCommand,
} from "@store/contracts/sync/fixtures";
import { replicaState } from "@store/db/replica.schema";
import { LocalAuthority, ReplicaStore, SyncEngine, SyncTransportService } from "@store/sync";
import { layerSqliteReplicaStore, SqliteReplica } from "@store/sync/sqlite";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeInventoryCommands } from "../../src/inventory/commands";
import type { InventoryActor } from "../../src/inventory/model";
import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";
import { typedCommands } from "./typed-commands";

const USER_ID = "user-1";
const OCCURRED_AT = lastUnitBuyerACommand.occurredAt;
const GENERAL = decodeCategoryId("general");
const IDLE_CATEGORY = decodeCategoryId("cat-idle");
const IDLE_PRODUCT = decodeProductId("prod-idle");
const SPARE_BATCH = decodeBatchId("batch-spare");
const PACK_BATCH = decodeBatchId("batch-packs");

type LocalSubmission = {
  readonly request: SyncSubmitCommandRequest;
  readonly result: SyncSubmitCommandResult;
};

type TwinDecision = {
  readonly local: SyncSubmitCommandResult;
  readonly postgres: SyncSubmitCommandResult;
};

let database: AuthorityPostgres;

const seededReplica = (organizationId: string) =>
  Layer.effectDiscard(
    SqliteReplica.use((handle) =>
      handle.db
        .insert(replicaState)
        .values({
          id: "singleton",
          organizationId,
          userId: USER_ID,
          replicaId: LAST_UNIT_REPLICA_A,
          epoch: LAST_UNIT_EPOCH,
          incarnation: "local",
          appliedCommitSequence: "0",
          nextClientSequence: "1",
          localCommitVersion: 0,
          caughtUpAt: OCCURRED_AT,
        })
        .pipe(Effect.orDie),
    ),
  ).pipe(Layer.provideMerge(SqliteReplica.layer()));

const recordingLocalAuthority = (submissions: Array<LocalSubmission>) =>
  Layer.effect(
    SyncTransportService,
    SyncTransportService.use((authority) =>
      Effect.succeed({
        ...authority,
        submitCommand: (request: SyncSubmitCommandRequest) =>
          authority
            .submitCommand(request)
            .pipe(Effect.tap((result) => Effect.sync(() => submissions.push({ request, result })))),
      }),
    ),
  ).pipe(Layer.provide(LocalAuthority.layer));

const twinLayer = (organizationId: string, submissions: Array<LocalSubmission>) =>
  Layer.mergeAll(
    SyncEngine.layer().pipe(
      Layer.provideMerge(recordingLocalAuthority(submissions)),
      Layer.provideMerge(layerSqliteReplicaStore(`parity-${organizationId}`)),
      Layer.provideMerge(seededReplica(organizationId)),
    ),
    PgClient.layer({
      url: Redacted.make(database.connectionString),
      maxConnections: 4,
      applicationName: "tabaaq-local-authority-parity-tests",
    }),
  );

const receiptOf = ({ page: _page, ...receipt }: SyncSubmitCommandResult) => receipt;

const outcomeOf = (result: SyncSubmitCommandResult) =>
  result.result._tag === "rejected"
    ? `${result.result.code}: ${result.result.message}`
    : result.result._tag;

type Steps = ReadonlyArray<ReadonlyArray<EnqueueCommandRequest>>;

const openTwin = (organizationId: OrganizationId, submissions: Array<LocalSubmission>) =>
  Effect.gen(function* () {
    const engine = yield* SyncEngine;
    const store = yield* ReplicaStore;
    const localAuthority = yield* SyncTransportService;
    const db = yield* PgDrizzle.makeWithDefaults().pipe(
      Effect.provideService(PgClient.PgClient, yield* PgClient.PgClient),
    );
    const postgresAuthority = typedCommands(makeInventoryCommands(db));
    const actor: InventoryActor = { organizationId, userId: USER_ID };
    yield* postgresAuthority.register(actor, { replicaId: LAST_UNIT_REPLICA_A });
    yield* engine.ensureRegistered();

    const decide = (steps: Steps) =>
      Effect.gen(function* () {
        const decisions: Array<TwinDecision> = [];
        for (const step of steps) {
          const decidedBefore = submissions.length;
          for (const request of step) yield* engine.saveCommand(request);
          yield* engine.drainUploads();
          for (const { request, result } of submissions.slice(decidedBefore)) {
            decisions.push({
              local: result,
              postgres: yield* postgresAuthority.submit(actor, request),
            });
          }
        }
        return decisions;
      });

    return { actor, store, localAuthority, postgresAuthority, decide };
  });

const decideOnBoth = (organization: string, steps: Steps) => {
  const organizationId = decodeOrganizationId(organization);
  const submissions: Array<LocalSubmission> = [];
  return Effect.runPromise(
    Effect.gen(function* () {
      const { actor, store, localAuthority, postgresAuthority, decide } = yield* openTwin(
        organizationId,
        submissions,
      );
      const decisions = yield* decide(steps);

      const last = submissions.at(-1);
      const repeated =
        last === undefined
          ? undefined
          : {
              local: yield* localAuthority.submitCommand(last.request),
              postgres: yield* postgresAuthority.submit(actor, last.request),
            };

      const head = OrgCommitSequence.make((yield* store.readSyncCursor()).appliedCommitSequence);
      const cursor = {
        epoch: LAST_UNIT_EPOCH,
        subscription: OPERATIONAL_SUBSCRIPTION,
        afterCommitSequence: head,
      };
      const localPage = yield* localAuthority.pull(cursor);
      const postgresPage = yield* postgresAuthority.pull(actor, {
        ...cursor,
        digestVersion: PARTITION_DIGEST_VERSION,
      });
      const digest = yield* store.applyRemotePage({
        ...postgresPage,
        incarnation: localPage.incarnation,
      });
      return { decisions, repeated, localPage, postgresPage, digest: digest.value };
    }).pipe(Effect.provide(twinLayer(organizationId, submissions)), Effect.scoped),
  );
};

const decideUnqueuedOnBoth = (organization: string, setup: Steps, command: SyncCommand) => {
  const organizationId = decodeOrganizationId(organization);
  const submissions: Array<LocalSubmission> = [];
  return Effect.runPromise(
    Effect.gen(function* () {
      const { actor, store, localAuthority, postgresAuthority, decide } = yield* openTwin(
        organizationId,
        submissions,
      );
      yield* decide(setup);
      const request: SyncSubmitCommandRequest = {
        organizationId,
        epoch: LAST_UNIT_EPOCH,
        replicaId: LAST_UNIT_REPLICA_A,
        clientSequence: ReplicaClientSequence.make(String(submissions.length + 1)),
        operationId: command.payload.commandId,
        payloadHash: canonicalPayloadHash(command),
        command,
        afterCommitSequence: OrgCommitSequence.make(
          (yield* store.readSyncCursor()).appliedCommitSequence,
        ),
      };
      return {
        local: yield* localAuthority.submitCommand(request),
        redecided: yield* localAuthority.submitCommand(request),
        postgres: yield* postgresAuthority.submit(actor, request),
      };
    }).pipe(Effect.provide(twinLayer(organizationId, submissions)), Effect.scoped),
  );
};

const expectParity = (twin: Awaited<ReturnType<typeof decideOnBoth>>) => {
  for (const { local, postgres } of twin.decisions) {
    expect(local.page?.transactions).toStrictEqual(postgres.page?.transactions);
    expect(local.page?.transactions).toHaveLength(1);
    expect(local.page?.nextCommitSequence).toBe(postgres.page?.nextCommitSequence);
    expect(local.page?.horizon).toBe(postgres.page?.horizon);
    expect(receiptOf(local)).toStrictEqual(receiptOf(postgres));
  }
  const lastDecision = twin.decisions.at(-1);
  expect(lastDecision).toBeDefined();
  expect(twin.repeated && receiptOf(twin.repeated.local)).toStrictEqual(
    lastDecision && receiptOf(lastDecision.local),
  );
  expect(twin.repeated && receiptOf(twin.repeated.postgres)).toStrictEqual(
    lastDecision && receiptOf(lastDecision.postgres),
  );
  expect(twin.localPage.transactions).toEqual([]);
  expect(twin.localPage.digest).toBeUndefined();
  expect(twin.postgresPage.transactions).toEqual([]);
  expect(twin.postgresPage.digest).toBeDefined();
  expect(twin.digest).toMatchObject({ repairRequired: false, digestVerified: true });
};

const queued = (
  command: SyncCommand,
  operationId = command.payload.commandId,
): EnqueueCommandRequest => ({
  operationId,
  command,
  occurredAt: command.payload.occurredAt,
});

const catalog = (commandId: string, writes: ReadonlyArray<CatalogRowWrite>): SyncCommand => ({
  _tag: "catalogWrite",
  payload: { commandId, deviceId: LAST_UNIT_REPLICA_A, occurredAt: OCCURRED_AT + 1, writes },
});

const categoryWrite = (
  id: string,
  name: string,
  expectedRowVersion: number | null = null,
): CatalogRowWrite => ({
  entity: "category",
  action: "upsert",
  id: decodeCategoryId(id),
  expectedRowVersion,
  row: { name, tracksPacks: true },
});

const productWrite = (
  id: string,
  input: {
    readonly categoryId: string;
    readonly name: string;
    readonly unitsPerPack: number;
    readonly retailPrice?: number;
  },
  expectedRowVersion: number | null = null,
): CatalogRowWrite => ({
  entity: "product",
  action: "upsert",
  id: decodeProductId(id),
  expectedRowVersion,
  row: {
    name: input.name,
    categoryId: decodeCategoryId(input.categoryId),
    aisle: "A1",
    composition: null,
    strength: "500mg",
    unitsPerPack: input.unitsPerPack,
    purchasePrice: 50,
    retailPrice: input.retailPrice ?? 100,
    unitPrice: 10,
    visible: true,
  },
});

const batchWrite = (
  id: string,
  input: {
    readonly productId: string;
    readonly movementId: string;
    readonly packQuantity: number;
    readonly unitQuantity: number;
    readonly note?: string;
  },
  expectedRowVersion: number | null = null,
): CatalogRowWrite => ({
  entity: "batch",
  action: "upsert",
  id: decodeBatchId(id),
  expectedRowVersion,
  movementId: input.movementId,
  note: input.note ?? null,
  row: {
    productId: decodeProductId(input.productId),
    batchNumber: "B-1",
    expiresAt: OCCURRED_AT + 86_400_000,
    packQuantity: input.packQuantity,
    unitQuantity: input.unitQuantity,
  },
});

const removal = (
  entity: CatalogRowWrite["entity"],
  id: string,
  expectedRowVersion: number,
): CatalogRowWrite => {
  switch (entity) {
    case "category":
      return { entity, action: "delete", id: decodeCategoryId(id), expectedRowVersion };
    case "product":
      return { entity, action: "delete", id: decodeProductId(id), expectedRowVersion };
    case "batch":
      return { entity, action: "delete", id: decodeBatchId(id), expectedRowVersion };
  }
};

const sale = (
  commandId: string,
  invoiceNumber: number,
  takes: ReadonlyArray<{
    readonly batchId?: string;
    readonly quantity: number;
    readonly quantityType?: "unit" | "pack";
    readonly packsOpened?: number;
    readonly salePrice?: number;
    readonly invoiceItemId?: string;
    readonly saleMovementId?: string;
  }>,
  overrides: {
    readonly invoiceId?: string;
    readonly customerName?: string | null;
    readonly soldQuantity?: number;
  } = {},
): SyncCommand => {
  const [first] = takes;
  const quantityType = first?.quantityType ?? "unit";
  const salePrice = first?.salePrice ?? 100;
  const batchOf = (take: (typeof takes)[number]) =>
    decodeBatchId(take.batchId ?? LAST_UNIT_BATCH_ID);
  const batchIds = new Set(takes.map(batchOf));
  return {
    _tag: "issueInvoice",
    payload: {
      ...lastUnitBuyerBCommand,
      commandId,
      invoiceId: decodeInvoiceId(overrides.invoiceId ?? commandId),
      invoiceNumber,
      input: {
        customerName: overrides.customerName ?? null,
        items: [
          {
            productId: LAST_UNIT_PRODUCT_ID,
            batchId: batchIds.size === 1 && first !== undefined ? batchOf(first) : null,
            quantity: overrides.soldQuantity ?? takes.reduce((sum, take) => sum + take.quantity, 0),
            quantityType,
            salePrice,
          },
        ],
      },
      allocations: takes.map((take, index) => ({
        invoiceItemId: decodeInvoiceItemId(take.invoiceItemId ?? `${commandId}-item-${index}`),
        saleMovementId: take.saleMovementId ?? `${commandId}-move-${index}`,
        openPackMovementId: null,
        productId: LAST_UNIT_PRODUCT_ID,
        batchId: batchOf(take),
        quantity: take.quantity,
        quantityType,
        salePrice,
        packsOpened: take.packsOpened ?? 0,
      })),
    },
  };
};

const seedSales = (unitsPerPack: number, packQuantity: number, unitQuantity: number) =>
  queued(
    catalog("seed", [
      categoryWrite(GENERAL, "General"),
      categoryWrite(IDLE_CATEGORY, "Idle"),
      productWrite(LAST_UNIT_PRODUCT_ID, { categoryId: GENERAL, name: "Last unit", unitsPerPack }),
      productWrite(IDLE_PRODUCT, { categoryId: IDLE_CATEGORY, name: "Idle", unitsPerPack: 1 }),
      batchWrite(LAST_UNIT_BATCH_ID, {
        productId: LAST_UNIT_PRODUCT_ID,
        movementId: "mv-seed",
        packQuantity,
        unitQuantity,
      }),
      batchWrite(PACK_BATCH, {
        productId: LAST_UNIT_PRODUCT_ID,
        movementId: "mv-seed-packs",
        packQuantity: 3,
        unitQuantity: 0,
      }),
    ]),
  );

describe("the local authority decides like the postgres authority", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("emits the same groups for catalog inserts, updates, deletes and their stock movements", async () => {
    const twin = await decideOnBoth("org-parity-catalog", [
      [
        queued(
          catalog("stock", [
            categoryWrite("cat-1", "Painkillers"),
            productWrite("prod-1", { categoryId: "cat-1", name: "Panadol", unitsPerPack: 10 }),
            batchWrite("batch-1", {
              productId: "prod-1",
              movementId: "mv-stock",
              packQuantity: 2,
              unitQuantity: 0,
            }),
            batchWrite(SPARE_BATCH, {
              productId: "prod-1",
              movementId: "mv-spare",
              packQuantity: 0,
              unitQuantity: 0,
            }),
          ]),
        ),
      ],
      [
        queued(
          catalog("edit", [
            categoryWrite("cat-1", "Pain relief", 1),
            productWrite(
              "prod-1",
              { categoryId: "cat-1", name: "Panadol Extra", unitsPerPack: 10, retailPrice: 120 },
              1,
            ),
            batchWrite(
              "batch-1",
              {
                productId: "prod-1",
                movementId: "mv-recount",
                packQuantity: 3,
                unitQuantity: 5,
                note: "Recount",
              },
              1,
            ),
          ]),
        ),
      ],
      [
        queued(
          catalog("shrink", [
            batchWrite(
              "batch-1",
              { productId: "prod-1", movementId: "mv-shrink", packQuantity: 1, unitQuantity: 0 },
              2,
            ),
            batchWrite(
              "batch-1",
              { productId: "prod-1", movementId: "mv-relabel", packQuantity: 1, unitQuantity: 0 },
              3,
            ),
          ]),
        ),
      ],
      [
        queued(
          catalog("second", [
            categoryWrite("cat-2", "Vitamins"),
            productWrite("prod-2", { categoryId: "cat-2", name: "Vitamin C", unitsPerPack: 1 }),
            batchWrite("batch-3", {
              productId: "prod-2",
              movementId: "mv-vitamins",
              packQuantity: 0,
              unitQuantity: 4,
            }),
          ]),
        ),
      ],
      [
        queued(
          catalog("empty", [
            batchWrite(
              "batch-3",
              { productId: "prod-2", movementId: "mv-empty", packQuantity: 0, unitQuantity: 0 },
              1,
            ),
          ]),
        ),
        queued(
          catalog("drop-batches", [
            removal("batch", "batch-3", 2),
            removal("batch", SPARE_BATCH, 1),
          ]),
        ),
        queued(catalog("drop-product", [removal("product", "prod-2", 1)])),
        queued(catalog("drop-category", [removal("category", "cat-2", 1)])),
      ],
    ]);

    expectParity(twin);
    expect(twin.decisions.map(({ local }) => outcomeOf(local))).toEqual(
      Array.from({ length: 8 }, () => "catalogWrite"),
    );
    expect(
      twin.decisions.map(({ local }) =>
        local.page?.transactions[0]?.changes.map((change) => `${change.action} ${change.entity}`),
      ),
    ).toEqual([
      ["upsert category", "upsert product", "upsert batch", "upsert stockMovement", "upsert batch"],
      ["upsert category", "upsert product", "upsert batch", "upsert stockMovement"],
      ["upsert batch", "upsert stockMovement", "upsert batch"],
      ["upsert category", "upsert product", "upsert batch", "upsert stockMovement"],
      ["upsert batch", "upsert stockMovement"],
      ["delete batch", "delete batch"],
      ["delete product"],
      ["delete category"],
    ]);
  });

  it("emits the same groups for sales, including packs opened across batches", async () => {
    const twin = await decideOnBoth("org-parity-sales", [
      [seedSales(10, 2, 1)],
      [queued({ _tag: "issueInvoice", payload: lastUnitBuyerACommand })],
      [
        queued(
          sale("sale-split", 2, [
            { quantity: 6, packsOpened: 1 },
            { batchId: PACK_BATCH, quantity: 12, packsOpened: 2 },
          ]),
        ),
      ],
      [
        queued(
          sale("sale-pack", 3, [{ batchId: PACK_BATCH, quantity: 1, quantityType: "pack" }], {
            customerName: "  Ada Lovelace  ",
          }),
        ),
        queued(sale("sale-loose", 4, [{ quantity: 3 }])),
      ],
    ]);

    expectParity(twin);
    expect(twin.decisions.map(({ local }) => outcomeOf(local))).toEqual([
      "catalogWrite",
      "issueInvoice",
      "issueInvoice",
      "issueInvoice",
      "issueInvoice",
    ]);
    expect(
      twin.decisions[2]?.local.page?.transactions[0]?.changes.map((change) => change.entity),
    ).toEqual([
      "invoice",
      "batch",
      "invoiceItem",
      "stockMovement",
      "stockMovement",
      "batch",
      "invoiceItem",
      "stockMovement",
      "stockMovement",
    ]);
  });

  it("rejects with the same code and message whatever a queued command gets wrong", async () => {
    const staleTopUp = (commandId: string) =>
      queued(
        catalog(commandId, [
          batchWrite(
            LAST_UNIT_BATCH_ID,
            {
              productId: LAST_UNIT_PRODUCT_ID,
              movementId: `${commandId}-move`,
              packQuantity: 0,
              unitQuantity: 60,
            },
            9,
          ),
        ]),
      );
    const staleEmptying = (commandId: string) =>
      queued(
        catalog(commandId, [
          batchWrite(
            LAST_UNIT_BATCH_ID,
            {
              productId: LAST_UNIT_PRODUCT_ID,
              movementId: `${commandId}-move`,
              packQuantity: 0,
              unitQuantity: 0,
            },
            9,
          ),
          batchWrite(
            PACK_BATCH,
            {
              productId: LAST_UNIT_PRODUCT_ID,
              movementId: `${commandId}-move-packs`,
              packQuantity: 0,
              unitQuantity: 0,
            },
            1,
          ),
        ]),
      );
    const twin = await decideOnBoth("org-parity-rejections", [
      [seedSales(1, 0, 9)],
      [queued({ _tag: "issueInvoice", payload: lastUnitBuyerACommand })],
      [
        staleTopUp("stale-top-up"),
        queued({
          _tag: "issueInvoice",
          payload: {
            ...lastUnitBuyerBCommand,
            invoiceNumber: 2,
            input: {
              ...lastUnitBuyerBCommand.input,
              items: lastUnitBuyerBCommand.input.items.map((line) => ({ ...line, quantity: 50 })),
            },
            allocations: lastUnitBuyerBCommand.allocations.map((take) => ({
              ...take,
              quantity: 50,
            })),
          },
        }),
      ],
      [
        queued(
          catalog("orphans", [
            productWrite("prod-orphan", {
              categoryId: "cat-gone",
              name: "Orphan",
              unitsPerPack: 1,
            }),
          ]),
        ),
        queued(
          catalog("orphan-batch", [
            batchWrite("batch-orphan", {
              productId: "prod-gone",
              movementId: "mv-orphan",
              packQuantity: 1,
              unitQuantity: 0,
            }),
          ]),
        ),
        queued(catalog("twice", [categoryWrite(GENERAL, "General again")])),
        queued(
          catalog("vanished", [
            batchWrite(
              "batch-vanished",
              {
                productId: LAST_UNIT_PRODUCT_ID,
                movementId: "mv-vanished",
                packQuantity: 1,
                unitQuantity: 0,
              },
              1,
            ),
          ]),
        ),
        queued(catalog("drop-vanished", [removal("category", "cat-vanished", 1)])),
        queued(
          catalog("recorded-movement", [
            batchWrite(
              LAST_UNIT_BATCH_ID,
              {
                productId: LAST_UNIT_PRODUCT_ID,
                movementId: "mv-seed",
                packQuantity: 0,
                unitQuantity: 7,
              },
              2,
            ),
          ]),
        ),
      ],
      [
        queued(sale("sale-reused-invoice", 2, [{ quantity: 1 }], { invoiceId: "sale-a" })),
        queued(sale("sale-reused-item", 3, [{ quantity: 1, invoiceItemId: "item-a" }])),
        queued(sale("sale-reused-movement", 4, [{ quantity: 1, saleMovementId: "move-a" }])),
        queued(sale("sale-uncovered", 5, [{ quantity: 1 }], { soldQuantity: 2 })),
        queued(sale("sale-overflow", 6, [{ quantity: 1, salePrice: 3_000_000_000 }])),
        queued(
          catalog("cmd-other", [categoryWrite("cat-mismatch", "Mismatch")]),
          "operation-mismatch",
        ),
      ],
      [
        queued(
          catalog("move-stale", [
            productWrite(IDLE_PRODUCT, { categoryId: GENERAL, name: "Idle", unitsPerPack: 2 }, 9),
          ]),
        ),
        queued(catalog("drop-idle-category", [removal("category", IDLE_CATEGORY, 1)])),
      ],
      [
        staleEmptying("stale-emptying"),
        queued(catalog("drop-stocked-batch", [removal("batch", LAST_UNIT_BATCH_ID, 2)])),
      ],
      [
        staleEmptying("stale-emptying-again"),
        queued(catalog("drop-stocked-product", [removal("product", LAST_UNIT_PRODUCT_ID, 1)])),
      ],
      [
        queued(catalog("drop-idle-product", [removal("product", IDLE_PRODUCT, 1)])),
        queued(
          catalog("late-batch", [
            batchWrite("batch-late", {
              productId: IDLE_PRODUCT,
              movementId: "mv-late",
              packQuantity: 1,
              unitQuantity: 0,
            }),
          ]),
        ),
        queued(catalog("drop-emptied-category", [removal("category", IDLE_CATEGORY, 1)])),
        queued(
          catalog("late-product", [
            productWrite("prod-late", { categoryId: IDLE_CATEGORY, name: "Late", unitsPerPack: 1 }),
          ]),
        ),
      ],
    ]);

    expectParity(twin);
    expect(twin.decisions.map(({ local }) => outcomeOf(local))).toEqual([
      "catalogWrite",
      "issueInvoice",
      `ENTITY_CONFLICT: Batch ${LAST_UNIT_BATCH_ID} changed since it was read.`,
      "INSUFFICIENT_STOCK: Not enough stock for Last unit: 8 available, 50 requested.",
      "ENTITY_RELATION_INVALID: Category cat-gone is not available in this organization.",
      "ENTITY_RELATION_INVALID: Product prod-gone is not available in this organization.",
      `ENTITY_CONFLICT: Category ${GENERAL} already exists.`,
      "ENTITY_CONFLICT: Batch batch-vanished is no longer available.",
      "ENTITY_CONFLICT: Category cat-vanished is no longer available.",
      "ENTITY_CONFLICT: Movement mv-seed is already recorded.",
      "INVOICE_IDENTITY_CONFLICT: This invoice id is already in use.",
      "ENTITY_CONFLICT: A record this command creates already exists.",
      "ENTITY_CONFLICT: A record this command creates already exists.",
      "INVALID_OPERATION: The sale allocations do not match the items.",
      "INVALID_OPERATION: A value in this command is out of range.",
      "COMMAND_IDENTITY_MISMATCH: The command id must match the envelope operation id.",
      `ENTITY_CONFLICT: Product ${IDLE_PRODUCT} changed since units per pack was read.`,
      `ENTITY_CONFLICT: ${catalogWriteError.categoryHasProducts}`,
      `ENTITY_CONFLICT: Batch ${LAST_UNIT_BATCH_ID} changed since it was read.`,
      `ENTITY_CONFLICT: ${catalogWriteError.batchHasStock}`,
      `ENTITY_CONFLICT: Batch ${LAST_UNIT_BATCH_ID} changed since it was read.`,
      `ENTITY_CONFLICT: ${catalogWriteError.productHasStock}`,
      "catalogWrite",
      `ENTITY_RELATION_INVALID: Product ${IDLE_PRODUCT} is not available in this organization.`,
      "catalogWrite",
      `ENTITY_RELATION_INVALID: Category ${IDLE_CATEGORY} is not available in this organization.`,
    ]);
  });

  const unqueued: ReadonlyArray<
    readonly [string, Steps, SyncCommand, Partial<CommandReceipt["result"]>]
  > = [
    [
      "two takes on one batch",
      [[seedSales(10, 2, 1)]],
      sale("sale-two-takes", 1, [{ quantity: 6 }, { quantity: 9 }]),
      { _tag: "issueInvoice", invoiceNumber: 1 },
    ],
    [
      "an invoice number that is taken",
      [[seedSales(10, 2, 1)], [queued(sale("sale-first", 1, [{ quantity: 1 }]))]],
      sale("sale-renumbered", 1, [{ quantity: 2 }]),
      { _tag: "issueInvoice", invoiceNumber: 2 },
    ],
    [
      "a category name that is taken",
      [[seedSales(10, 2, 1)]],
      catalog("name-taken", [categoryWrite("cat-new", "Idle")]),
      {
        _tag: "rejected",
        code: "ENTITY_CONFLICT",
        message: "Category name Idle is already in use.",
      },
    ],
    [
      "a movement id used twice in one write",
      [[seedSales(10, 2, 1)]],
      catalog("movement-twice", [
        batchWrite("batch-x", {
          productId: LAST_UNIT_PRODUCT_ID,
          movementId: "mv-twice",
          packQuantity: 1,
          unitQuantity: 0,
        }),
        batchWrite("batch-y", {
          productId: LAST_UNIT_PRODUCT_ID,
          movementId: "mv-twice",
          packQuantity: 1,
          unitQuantity: 0,
        }),
      ]),
      {
        _tag: "rejected",
        code: "ENTITY_CONFLICT",
        message: "Movement mv-twice is already recorded.",
      },
    ],
    [
      "an invoice item id used twice in one sale",
      [[seedSales(10, 2, 1)]],
      sale("sale-item-twice", 1, [
        { quantity: 1, invoiceItemId: "item-twice" },
        { quantity: 1, invoiceItemId: "item-twice" },
      ]),
      {
        _tag: "rejected",
        code: "ENTITY_CONFLICT",
        message: "A record this command creates already exists.",
      },
    ],
  ];

  it.each(unqueued)(
    "decides %s like postgres and the same way twice, though the engine never queues it",
    async (_name, setup, command, expected) => {
      const twin = await decideUnqueuedOnBoth(
        `org-parity-${command.payload.commandId}`,
        setup,
        command,
      );
      expect(twin.local.result).toMatchObject(expected);
      expect(twin.local.page?.transactions).toStrictEqual(twin.postgres.page?.transactions);
      expect(twin.local.page?.transactions).toHaveLength(1);
      expect(twin.local.page?.horizon).toBe(twin.postgres.page?.horizon);
      expect(receiptOf(twin.local)).toStrictEqual(receiptOf(twin.postgres));
      expect(twin.redecided).toStrictEqual(twin.local);
    },
  );
});
