import * as PgClient from "@effect/sql-pg/PgClient";
import {
  ImportCatalogResult,
  ImportId,
  ImportPartReceipt,
  LOCAL_ORGANIZATION_ID,
  LOCAL_USER_ID,
  PARTITION_DIGEST_VERSION,
  PartitionDigest,
  SnapshotPartPayload,
  SYNC_SCHEMA_VERSION,
  type CatalogRowWrite,
  type EnqueueCommandRequest,
  type ImportCatalogRequest,
  type SyncCommand,
  type SyncEntity,
} from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import {
  decodeBatchId,
  decodeCategoryId,
  decodeInvoiceId,
  decodeInvoiceItemId,
  decodeOrganizationId,
  decodeProductId,
  decodePurchaseOrderId,
  decodePurchaseOrderItemId,
  decodeSupplierId,
} from "@store/contracts/ids";
import { replicaState } from "@store/db/replica.schema";
import { ReplicaStore, SyncEngine, SyncTransportService, type SyncTransport } from "@store/sync";
import {
  layerSqliteReplicaStore,
  LocalAuthority,
  LOCAL_AUTHORITY_EPOCH,
  SqliteReplica,
  sqliteCatalogParts,
  sqlitePartitionDigest,
  type SqliteReplicaHandle,
} from "@store/sync/sql-client";
import { layerNodeSqliteReplica } from "@store/sync/sqlite";
import { sql } from "drizzle-orm";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Struct from "effect/Struct";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeInventoryCommands } from "../../src/inventory/commands";
import type { InventoryError } from "../../src/inventory/errors";
import { makeInventoryImports } from "../../src/inventory/imports";
import type { InventoryActor } from "../../src/inventory/model";
import type { InventoryDrizzle } from "../../src/inventory/postgres";
import { makeInventorySnapshots } from "../../src/inventory/snapshots";
import { claimsFor, TEST_ACCESS_TOKEN, webHandlerFor } from "../lib/app";
import { startAuthorityPostgres, type AuthorityPostgres } from "./authority-postgres";
import { typedCommands } from "./typed-commands";

const DEVICE = "device-local";
const OCCURRED_AT = 1_760_000_000_000;
const OWNER = "user-owner";
const CLERK = "user-clerk";

const decodeImportId = Schema.decodeUnknownSync(ImportId);
const decodeDigest = Schema.decodeUnknownSync(PartitionDigest);
const decodeReceipt = Schema.decodeUnknownSync(Schema.fromJsonString(ImportPartReceipt));
const decodeResult = Schema.decodeUnknownSync(Schema.fromJsonString(ImportCatalogResult));
const decodePart = Schema.decodeUnknownEffect(Schema.fromJsonString(SnapshotPartPayload));

let database: AuthorityPostgres;

const postgres = () =>
  PgClient.layer({
    url: Redacted.make(database.connectionString),
    maxConnections: 4,
    applicationName: "tabaaq-catalog-import-tests",
  });

const openDb = Effect.gen(function* () {
  const client = yield* PgClient.PgClient;
  return yield* PgDrizzle.makeWithDefaults().pipe(Effect.provideService(PgClient.PgClient, client));
});

const seededReplica = (identity: {
  readonly organizationId: string;
  readonly userId: string;
  readonly replicaId: string;
  readonly epoch: string;
}) =>
  Layer.effectDiscard(
    SqliteReplica.use((handle) =>
      handle.db
        .insert(replicaState)
        .values({
          id: "singleton",
          organizationId: identity.organizationId,
          userId: identity.userId,
          replicaId: identity.replicaId,
          epoch: identity.epoch,
          incarnation: "local",
          appliedCommitSequence: "0",
          nextClientSequence: "1",
          localCommitVersion: 0,
        })
        .pipe(Effect.orDie),
    ),
  ).pipe(Layer.provideMerge(layerNodeSqliteReplica()));

const catalog = (commandId: string, writes: ReadonlyArray<CatalogRowWrite>): SyncCommand => ({
  _tag: "catalogWrite",
  payload: { commandId, deviceId: DEVICE, occurredAt: OCCURRED_AT, writes },
});

const queued = (command: SyncCommand): EnqueueCommandRequest => ({
  operationId: command.payload.commandId,
  command,
  occurredAt: command.payload.occurredAt,
});

const category = (id: string, name: string): CatalogRowWrite => ({
  entity: "category",
  action: "upsert",
  id: decodeCategoryId(id),
  expectedRowVersion: null,
  row: { name, tracksPacks: true },
});

const product = (
  id: string,
  categoryId: string,
  name: string,
  unitsPerPack: number,
): CatalogRowWrite => ({
  entity: "product",
  action: "upsert",
  id: decodeProductId(id),
  expectedRowVersion: null,
  row: {
    name,
    categoryId: decodeCategoryId(categoryId),
    aisle: null,
    composition: "Paracetamol “500”",
    strength: "500mg",
    unitsPerPack,
    purchasePrice: 50,
    retailPrice: 100,
    unitPrice: 10,
    visible: true,
  },
});

const batch = (
  id: string,
  productId: string,
  stock: { readonly packs: number; readonly units: number },
  expectedRowVersion: number | null = null,
): CatalogRowWrite => ({
  entity: "batch",
  action: "upsert",
  id: decodeBatchId(id),
  expectedRowVersion,
  movementId: `move-${id}-${expectedRowVersion ?? 0}`,
  note: expectedRowVersion === null ? null : "Recount",
  row: {
    productId: decodeProductId(productId),
    batchNumber: `B-${id}`,
    expiresAt: OCCURRED_AT + 86_400_000,
    packQuantity: stock.packs,
    unitQuantity: stock.units,
  },
});

const supplier = (id: string, name: string): CatalogRowWrite => ({
  entity: "supplier",
  action: "upsert",
  id: decodeSupplierId(id),
  expectedRowVersion: null,
  row: { name, phone: "923001234567", note: null },
});

const order = (
  id: string,
  input: { readonly status: "draft" | "sent"; readonly sentAt: number | null },
  expectedRowVersion: number | null = null,
): CatalogRowWrite => ({
  entity: "purchaseOrder",
  action: "upsert",
  id: decodePurchaseOrderId(id),
  expectedRowVersion,
  row: {
    orderNumber: 1,
    supplierId: decodeSupplierId("sup-acme"),
    status: input.status,
    note: "Monthly restock",
    sentAt: input.sentAt,
    expectedAt: OCCURRED_AT + 172_800_000,
    total: 290,
  },
});

const line = (
  id: string,
  input: {
    readonly productId: string;
    readonly productName: string;
    readonly quantity: number;
    readonly quantityType: "unit" | "pack";
    readonly baseUnitQuantity: number;
  },
): CatalogRowWrite => ({
  entity: "purchaseOrderItem",
  action: "upsert",
  id: decodePurchaseOrderItemId(id),
  expectedRowVersion: null,
  row: {
    purchaseOrderId: decodePurchaseOrderId("po-1"),
    productId: decodeProductId(input.productId),
    productName: input.productName,
    quantity: input.quantity,
    quantityType: input.quantityType,
    baseUnitQuantity: input.baseUnitQuantity,
    packCost: 50,
  },
});

const delivery = (
  id: string,
  stock: { readonly packs: number; readonly units: number },
): CatalogRowWrite => ({
  entity: "batch",
  action: "upsert",
  id: decodeBatchId(id),
  expectedRowVersion: null,
  movementId: `move-${id}`,
  note: null,
  row: {
    productId: decodeProductId("prod-panadol"),
    batchNumber: `B-${id}`,
    expiresAt: OCCURRED_AT + 86_400_000,
    packQuantity: stock.packs,
    unitQuantity: stock.units,
  },
  receipt: { purchaseOrderItemId: decodePurchaseOrderItemId("pol-panadol") },
});

const sale = (
  commandId: string,
  invoiceNumber: number,
  take: { readonly productId: string; readonly batchId: string; readonly quantity: number },
  packsOpened: number,
): SyncCommand => ({
  _tag: "issueInvoice",
  payload: {
    commandId,
    deviceId: DEVICE,
    occurredAt: OCCURRED_AT + invoiceNumber,
    invoiceId: decodeInvoiceId(commandId),
    invoiceNumber,
    input: {
      customerName: "Ada",
      items: [
        {
          productId: decodeProductId(take.productId),
          batchId: decodeBatchId(take.batchId),
          quantity: take.quantity,
          quantityType: "unit",
          salePrice: 12,
        },
      ],
    },
    allocations: [
      {
        invoiceItemId: decodeInvoiceItemId(`${commandId}-item`),
        saleMovementId: `${commandId}-move`,
        openPackMovementId: packsOpened > 0 ? `${commandId}-open` : null,
        productId: decodeProductId(take.productId),
        batchId: decodeBatchId(take.batchId),
        quantity: take.quantity,
        quantityType: "unit",
        salePrice: 12,
        packsOpened,
      },
    ],
  },
});

const localHistory: ReadonlyArray<SyncCommand> = [
  catalog("stock", [
    category("cat-pain", "Pain relief"),
    category("cat-cold", "Cold & flu"),
    product("prod-panadol", "cat-pain", "Panadol", 10),
    product("prod-gone", "cat-cold", "Discontinued syrup", 1),
    batch("batch-panadol", "prod-panadol", { packs: 3, units: 2 }),
    batch("batch-gone", "prod-gone", { packs: 0, units: 1 }),
  ]),
  sale("sale-1", 1, { productId: "prod-panadol", batchId: "batch-panadol", quantity: 5 }, 1),
  sale("sale-2", 2, { productId: "prod-gone", batchId: "batch-gone", quantity: 1 }, 0),
  catalog("recount", [batch("batch-panadol", "prod-panadol", { packs: 4, units: 0 }, 2)]),
  catalog("retire-batch", [
    { entity: "batch", action: "delete", id: decodeBatchId("batch-gone"), expectedRowVersion: 2 },
  ]),
  catalog("suppliers", [
    supplier("sup-acme", "Acme Pharma"),
    supplier("sup-dropped", "Dropped Distributor"),
  ]),
  catalog("order-draft", [
    order("po-1", { status: "draft", sentAt: null }),
    line("pol-panadol", {
      productId: "prod-panadol",
      productName: "Panadol",
      quantity: 5,
      quantityType: "pack",
      baseUnitQuantity: 50,
    }),
    line("pol-gone", {
      productId: "prod-gone",
      productName: "Discontinued syrup",
      quantity: 4,
      quantityType: "unit",
      baseUnitQuantity: 4,
    }),
  ]),
  catalog("order-send", [order("po-1", { status: "sent", sentAt: OCCURRED_AT + 5 }, 1)]),
  catalog("order-receive", [delivery("batch-delivered", { packs: 2, units: 3 })]),
  catalog("supplier-drop", [
    {
      entity: "supplier",
      action: "delete",
      id: decodeSupplierId("sup-dropped"),
      expectedRowVersion: 1,
    },
  ]),
  catalog("retire-product", [
    {
      entity: "product",
      action: "delete",
      id: decodeProductId("prod-gone"),
      expectedRowVersion: 1,
    },
  ]),
];

const LOCAL_ROW_COUNTS = {
  category: 2,
  product: 1,
  batch: 2,
  invoice: 2,
  invoiceItem: 2,
  stockMovement: 7,
  supplier: 1,
  purchaseOrder: 1,
  purchaseOrderItem: 2,
} as const satisfies Record<SyncEntity, number>;

const SERVER_OWNED = new Set([
  "organizationId",
  "createdByUserId",
  "updatedByUserId",
  "actorUserId",
]);

const ENTITIES: ReadonlyArray<SyncEntity> = Struct.keys(syncEntityRows);

const catalogOf = (handle: SqliteReplicaHandle) =>
  Effect.forEach(ENTITIES, (entity) =>
    handle.db
      .select()
      .from(syncEntityRows[entity].table)
      .all()
      .pipe(
        Effect.map((rows) =>
          rows
            .map((row) =>
              Object.fromEntries(Object.entries(row).filter(([key]) => !SERVER_OWNED.has(key))),
            )
            .sort((left, right) => String(left["id"]).localeCompare(String(right["id"]))),
        ),
      ),
  );

const localWorkspace = (importId: string) =>
  Effect.gen(function* () {
    const engine = yield* SyncEngine;
    const handle = yield* SqliteReplica;
    yield* engine.ensureRegistered();
    for (const command of localHistory) {
      yield* engine.saveCommand(queued(command));
      yield* engine.drainUploads();
    }
    const digest = yield* sqlitePartitionDigest(handle.db);
    const parts = yield* sqliteCatalogParts(handle.db, {
      partId: importId,
      organizationId: LOCAL_ORGANIZATION_ID,
    }).pipe(Stream.runCollect);
    return { digest, parts, catalog: yield* catalogOf(handle) };
  }).pipe(
    Effect.provide(
      SyncEngine.layer().pipe(
        Layer.provideMerge(LocalAuthority.layer),
        Layer.provideMerge(
          layerSqliteReplicaStore("import-local", { authority: LocalAuthority.submitWithin }),
        ),
        Layer.provideMerge(
          seededReplica({
            organizationId: LOCAL_ORGANIZATION_ID,
            userId: LOCAL_USER_ID,
            replicaId: DEVICE,
            epoch: LOCAL_AUTHORITY_EPOCH,
          }),
        ),
      ),
    ),
    Effect.scoped,
  );

const authorityFor = (db: InventoryDrizzle, actor: InventoryActor): SyncTransport => {
  const commands = typedCommands(makeInventoryCommands(db));
  const snapshots = makeInventorySnapshots(db);
  const settled = <A>(effect: Effect.Effect<A, InventoryError>) =>
    effect.pipe(Effect.catchTag("InventoryDatabaseError", (error) => Effect.die(error)));
  return {
    registerReplica: (request) => settled(commands.register(actor, request)),
    submitCommand: (request) => settled(commands.submit(actor, request)),
    getReceipt: (operationId) => settled(commands.receipt(actor, operationId)),
    pull: (request) => settled(commands.pull(actor, request)),
    acquireSnapshot: (request) => settled(snapshots.acquireSnapshot(actor, request)),
    readSnapshotPart: (snapshotId, partNumber) =>
      settled(snapshots.readSnapshotPartEncoded(actor, snapshotId, partNumber)).pipe(
        Effect.flatMap((part) => Effect.orDie(decodePart(part.json))),
      ),
  };
};

const organizationReplica = (db: InventoryDrizzle, actor: InventoryActor, replicaId: string) =>
  Layer.build(
    SyncEngine.layer().pipe(
      Layer.provideMerge(Layer.succeed(SyncTransportService, authorityFor(db, actor))),
      Layer.provideMerge(layerSqliteReplicaStore(`import-${replicaId}`)),
      Layer.provideMerge(
        seededReplica({
          organizationId: actor.organizationId,
          userId: actor.userId,
          replicaId,
          epoch: "1",
        }),
      ),
    ),
  );

const serverDigest = (db: InventoryDrizzle, organizationId: string) =>
  db
    .execute(
      sql`select "sync"."partition_digest"(${organizationId}, ${PARTITION_DIGEST_VERSION}::integer) ->> 'digest' as "value"`,
      "objects",
    )
    .pipe(
      Effect.map(
        (rows) =>
          Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ value: Schema.String })))(rows)[0]
            ?.value,
      ),
    );

const requestFor = (
  actor: InventoryActor,
  local: {
    readonly digest: { readonly digest: string; readonly version: number } | undefined;
  },
  partCount: number,
): ImportCatalogRequest => ({
  organizationId: decodeOrganizationId(actor.organizationId),
  partCount,
  digest: decodeDigest(local.digest?.digest),
  digestVersion: local.digest?.version ?? 0,
});

const run = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient | Scope.Scope>) =>
  Effect.runPromise(effect.pipe(Effect.provide(postgres()), Effect.scoped));

describe("publishing a local workspace into an empty organization", () => {
  beforeAll(async () => {
    database = await startAuthorityPostgres();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  });

  it("bootstraps every replica to the digest and rows the device held", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* openDb;
        const imports = makeInventoryImports(db);
        const owner: InventoryActor = { organizationId: "org-published", userId: OWNER };
        const clerk: InventoryActor = { organizationId: "org-published", userId: CLERK };
        const importId = decodeImportId("import-published");
        const local = yield* localWorkspace(importId);

        const waiting = yield* organizationReplica(db, owner, "replica-owner");
        const waitingEngine = Context.get(waiting, SyncEngine);
        yield* waitingEngine.ensureRegistered();
        yield* waitingEngine.catchUp();

        const unasked = yield* imports.status(owner, importId);
        const receipts = yield* Effect.forEach(local.parts, (part) =>
          imports
            .stagePart(owner, importId, part.partNumber, part.bodyText)
            .pipe(Effect.map((staged) => decodeReceipt(staged.json))),
        );
        const request = requestFor(owner, local, local.parts.length);
        const mismatched = yield* imports
          .commit(owner, importId, { ...request, digest: decodeDigest("0".repeat(64)) })
          .pipe(Effect.flip);
        const miscounted = { ...request, partCount: request.partCount + 1 };
        const unlanded = yield* imports.commit(owner, importId, miscounted).pipe(Effect.flip);
        const staged = yield* imports.status(owner, importId);
        const landed = yield* imports.commit(owner, importId, request);
        const committed = decodeResult(landed.json);
        const settled = yield* imports.status(owner, importId);
        const later = decodeImportId("import-later");
        const superseded = yield* imports.status(owner, later);
        const refused = yield* imports.commit(owner, later, request).pipe(Effect.flip);
        const repeated = decodeResult((yield* imports.commit(owner, importId, request)).json);
        const asked = decodeResult((yield* imports.commit(owner, importId, miscounted)).json);
        const restaged = yield* imports
          .stagePart(owner, importId, 1, local.parts[0]?.bodyText ?? "")
          .pipe(Effect.map((staged) => decodeReceipt(staged.json)));

        yield* waitingEngine.catchUp();
        const fresh = yield* organizationReplica(db, clerk, "replica-clerk");
        const freshEngine = Context.get(fresh, SyncEngine);
        yield* freshEngine.ensureRegistered();
        yield* freshEngine.catchUp();

        const held = (replica: typeof fresh) =>
          Effect.gen(function* () {
            const handle = yield* SqliteReplica;
            const store = yield* ReplicaStore;
            return {
              digest: (yield* sqlitePartitionDigest(handle.db))?.digest,
              catalog: yield* catalogOf(handle),
              cursor: (yield* store.readSyncCursor()).appliedCommitSequence,
            };
          }).pipe(Effect.provide(replica));

        const leftovers = yield* db.execute(
          sql`select count(*)::int as "parts" from "import_parts" where "organization_id" = ${owner.organizationId}`,
          "objects",
        );
        const tombstones = yield* db.execute(
          sql`select "id", "name", "deleted_at" is not null as "deleted" from "products" where "organization_id" = ${owner.organizationId} and "deleted_at" is not null
              union all
              select "id", "batch_number", "deleted_at" is not null from "batches" where "organization_id" = ${owner.organizationId} and "deleted_at" is not null`,
          "objects",
        );
        const owners = yield* db.execute(
          sql`select distinct "created_by_user_id" as "user" from "products" where "organization_id" = ${owner.organizationId}
              union select distinct "actor_user_id" from "stock_movements" where "organization_id" = ${owner.organizationId}
              union select distinct "organization_id" from "invoices" where "organization_id" = ${owner.organizationId}`,
          "objects",
        );
        const purchasing = yield* db.execute(
          sql`select "l"."id" as "line", "l"."received_base_units" as "received", "p"."deleted_at" is not null as "productDeleted",
                (select count(*)::int from "stock_movements" as "m"
                  where "m"."organization_id" = "l"."organization_id"
                    and "m"."purchase_order_id" = "l"."purchase_order_id"
                    and "m"."product_id" = "l"."product_id") as "deliveries"
              from "purchase_order_items" as "l"
              join "products" as "p" on "p"."organization_id" = "l"."organization_id" and "p"."id" = "l"."product_id"
              where "l"."organization_id" = ${owner.organizationId}
              order by "l"."id"`,
          "objects",
        );
        const schemaVersions = yield* db.execute(
          sql`select min("schema_version")::int as "lowest", count(*)::int as "replicas" from "replicas" where "organization_id" = ${owner.organizationId}`,
          "objects",
        );
        const beforeDelivery = { owner: yield* held(waiting), clerk: yield* held(fresh) };
        const delivered = yield* freshEngine.saveCommand(
          queued(catalog("deliver-after", [delivery("batch-after", { packs: 1, units: 0 })])),
        );
        yield* freshEngine.drainUploads();
        yield* waitingEngine.catchUp();
        const afterDelivery = { owner: yield* held(waiting), clerk: yield* held(fresh) };
        const deliveredStatus = yield* Effect.provide(
          ReplicaStore.use((store) => store.readCommandStatus(delivered.operationId)),
          fresh,
        );
        const receivedAfter = yield* db.execute(
          sql`select "received_base_units" as "received", "row_version"::int as "version" from "purchase_order_items" where "organization_id" = ${owner.organizationId} and "id" = 'pol-panadol'`,
          "objects",
        );

        return {
          local,
          receipts,
          mismatched,
          unlanded,
          unasked,
          staged,
          settled,
          superseded,
          refused,
          fanout: landed.fanout,
          committed,
          repeated,
          asked,
          restaged,
          beforeDelivery,
          afterDelivery,
          deliveredStatus,
          receivedAfter,
          purchasing,
          schemaVersions,
          leftovers,
          tombstones,
          owners,
          authority: yield* serverDigest(db, owner.organizationId),
        };
      }),
    );

    const localDigest = outcome.local.digest?.digest;
    expect(localDigest).toBeDefined();
    expect(outcome.local.digest?.version).toBe(PARTITION_DIGEST_VERSION);
    expect(outcome.local.catalog.map((rows) => rows.length)).toEqual(
      ENTITIES.map((entity) => LOCAL_ROW_COUNTS[entity]),
    );
    expect(outcome.receipts.map((receipt) => receipt.partNumber)).toEqual(
      outcome.local.parts.map((part) => part.partNumber),
    );
    expect(outcome.mismatched).toMatchObject({ code: "INVALID_PAYLOAD_HASH" });
    expect(outcome.committed).toMatchObject({
      importId: "import-published",
      horizon: "1",
      digest: localDigest,
      digestVersion: PARTITION_DIGEST_VERSION,
    });
    expect(
      Object.fromEntries(
        outcome.committed.entityCounts.map((entry) => [entry.entity, entry.rowCount]),
      ),
    ).toEqual(LOCAL_ROW_COUNTS);
    expect(outcome.fanout).toMatchObject({ epoch: "1", horizon: "1", group: "" });
    expect(outcome.unlanded).toMatchObject({ code: "INVALID_OPERATION" });
    expect(outcome.unasked).toEqual({ _tag: "none" });
    expect(outcome.staged).toEqual({ _tag: "none" });
    expect(outcome.settled).toStrictEqual({ _tag: "committed", result: outcome.committed });
    expect(outcome.refused).toMatchObject({ code: "ENTITY_CONFLICT" });
    expect(outcome.superseded).toEqual({
      _tag: "other",
      message: outcome.refused.message,
    });
    expect(outcome.repeated).toStrictEqual(outcome.committed);
    expect(outcome.asked).toStrictEqual(outcome.committed);
    expect(outcome.restaged.partNumber).toBe(1);
    expect(outcome.leftovers).toEqual([{ parts: 0 }]);
    expect(outcome.tombstones).toHaveLength(2);
    expect(new Set(outcome.owners.map((row) => Object.values(row)[0]))).toEqual(
      new Set(["org-published", OWNER]),
    );

    expect(outcome.purchasing).toEqual([
      { line: "pol-gone", received: 0, productDeleted: true, deliveries: 0 },
      { line: "pol-panadol", received: 23, productDeleted: false, deliveries: 1 },
    ]);
    expect(outcome.schemaVersions).toEqual([{ lowest: SYNC_SCHEMA_VERSION, replicas: 2 }]);

    for (const replica of [outcome.beforeDelivery.owner, outcome.beforeDelivery.clerk]) {
      expect(replica.digest).toBe(localDigest);
      expect(replica.catalog).toStrictEqual(outcome.local.catalog);
      expect(replica.cursor).toBe("1");
    }
    expect(outcome.deliveredStatus).toBe("integrated");
    expect(outcome.receivedAfter).toEqual([{ received: 33, version: 3 }]);
    expect(outcome.afterDelivery.clerk.cursor).toBe("2");
    expect(outcome.afterDelivery.owner.cursor).toBe("2");
    expect(outcome.afterDelivery.owner.digest).toBe(outcome.afterDelivery.clerk.digest);
    expect(outcome.afterDelivery.owner.digest).toBe(outcome.authority);
    expect(outcome.afterDelivery.owner.digest).not.toBe(localDigest);
  });

  it("answers a status read without writing, and only for an owner", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* openDb;
        const imports = makeInventoryImports(db);
        const importId = decodeImportId("import-asked");
        const ask = (role: "owner" | "member", organizationId: string) =>
          Effect.promise(async () => {
            const handler = await webHandlerFor({
              claims: claimsFor(role, organizationId),
              imports,
            });
            const response = await handler(
              new Request(`http://localhost/api/sync/imports/${importId}`, {
                headers: { authorization: `Bearer ${TEST_ACCESS_TOKEN}` },
              }),
            );
            return { status: response.status, body: await response.json() };
          });
        const states = (organizationId: string) =>
          db.execute(
            sql`select count(*)::int as "rows" from "inventory_state" where "organization_id" = ${organizationId}`,
            "objects",
          );

        const member = yield* ask("member", "org-asked");
        const empty = yield* ask("owner", "org-asked");
        const untouched = yield* states("org-asked");

        yield* db.execute(
          sql`insert into "inventory_state" ("organization_id", "incarnation", "epoch", "commit_sequence", "retention_floor")
              values ('org-stocked', 'incarnation-test', '1', 3, 0)`,
        );
        const stocked = yield* ask("owner", "org-stocked");
        const refused = yield* imports
          .commit(
            { organizationId: "org-stocked", userId: OWNER },
            importId,
            requestFor(
              { organizationId: "org-stocked", userId: OWNER },
              { digest: { digest: "a".repeat(64), version: PARTITION_DIGEST_VERSION } },
              1,
            ),
          )
          .pipe(Effect.flip);
        return { member, empty, untouched, stocked, refused };
      }),
    );

    expect(outcome.member.status).toBe(403);
    expect(outcome.member.body).toMatchObject({ error: { code: "OWNER_REQUIRED" } });
    expect(outcome.empty).toEqual({ status: 200, body: { _tag: "none" } });
    expect(outcome.untouched).toEqual([{ rows: 0 }]);
    expect(outcome.refused).toMatchObject({ code: "ENTITY_CONFLICT" });
    expect(outcome.stocked).toEqual({
      status: 200,
      body: { _tag: "other", message: outcome.refused.message },
    });
  });
});
