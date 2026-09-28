import { openNodeReplicaSqlite } from "@store/client-db/node-sqlite";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { replicaLegacyPort } from "../../../src/lib/legacy-migration/browser";
import { extractLegacyChanges } from "../../../src/lib/legacy-migration/extract";
import { legacyDatabaseName } from "../../../src/lib/legacy-migration/model";
import {
  LEGACY_CARRY_OVER_NOTE,
  legacyOperationIds,
  legacySnapshotNeeds,
  planLegacyMigration,
  type LegacyPlanDecision,
} from "../../../src/lib/legacy-migration/plan";
import {
  actor,
  API_BASE_URL,
  crudRows,
  identity,
  legacyArchive,
  ORGANIZATION_ID,
  seedServerReplica,
  T0,
} from "./fixtures";

const databaseName = legacyDatabaseName(API_BASE_URL, ORGANIZATION_ID);

const openServerReplica = async () => {
  const replica = await openNodeReplicaSqlite(identity);
  await seedServerReplica(replica);
  return replica;
};

const planAgainst = async (
  replica: Awaited<ReturnType<typeof openServerReplica>>,
  archive = legacyArchive(databaseName),
) => {
  const changes = extractLegacyChanges(archive);
  const port = replicaLegacyPort(replica, actor);
  const snapshot = await Effect.runPromise(port.loadSnapshot(legacySnapshotNeeds(changes)));
  const present = await Effect.runPromise(port.readOutcomes(legacyOperationIds(identity, changes)));
  return {
    port,
    changes,
    decisions: planLegacyMigration({
      identity,
      changes,
      replica: snapshot,
      queued: new Set(present.map((outcome) => outcome.operationId)),
      now: T0 + 30_000,
    }),
  };
};

const PLANNED_ORDER: ReadonlyArray<string> = [
  "c-new",
  "p-new",
  "b-new",
  "p-synced",
  "b-synced",
  "c-gone",
  "inv-synced",
  "inv-server",
  "inv-unsynced",
];

const byLegacyRow = (decisions: ReadonlyArray<LegacyPlanDecision>, rowId: string) =>
  decisions[PLANNED_ORDER.indexOf(rowId)];

const enqueued = (decision: LegacyPlanDecision | undefined) => {
  if (decision?._tag !== "enqueue") throw new Error(`Expected an enqueue, got ${decision?._tag}.`);
  return decision;
};

describe("legacy change extraction", () => {
  it("separates sale transactions from catalog writes and collapses rows in queue order", () => {
    const changes = extractLegacyChanges(legacyArchive(databaseName));

    expect(changes.undecodable).toEqual([]);
    expect(changes.catalog.map((change) => [change.table, change.rowId, change.kind])).toEqual([
      ["categories", "c-new", "create"],
      ["products", "p-new", "create"],
      ["batches", "b-new", "create"],
      ["products", "p-synced", "patch"],
      ["batches", "b-synced", "patch"],
      ["categories", "c-gone", "delete"],
    ]);
    const batch = changes.catalog.find((change) => change.rowId === "b-synced");
    expect(batch?.fields).toEqual({ packQuantity: 5 });
    expect(batch?.deltas).toEqual({ packQuantity: 1 });
    expect(batch?.entries.map((entry) => entry.clientId)).toEqual([13]);
    expect(changes.catalog.find((change) => change.rowId === "p-synced")?.fields).toEqual({
      retailPrice: 150,
    });
    expect(changes.sales.map((sale) => [sale.command.invoiceId, sale.sources])).toEqual([
      ["inv-synced", ["journal"]],
      ["inv-server", ["journal"]],
      ["inv-unsynced", ["crud", "journal"]],
    ]);
  });

  it("rebuilds a queued sale command from ps_crud when the journal is gone", () => {
    const archive = { ...legacyArchive(databaseName), saleOutbox: [] };
    const [sale] = extractLegacyChanges(archive).sales;
    expect(sale?.sources).toEqual(["crud"]);
    expect(sale?.command).toEqual({
      commandId: "cmd-unsynced",
      deviceId: "legacy-device-1",
      occurredAt: T0 + 9_000,
      invoiceId: "inv-unsynced",
      invoiceNumber: 2,
      input: {
        customerName: "Walk-in",
        items: [
          {
            productId: "p-synced",
            batchId: "b-synced",
            quantity: 1,
            quantityType: "pack",
            salePrice: 150,
          },
        ],
      },
      allocations: [
        {
          invoiceItemId: "inv-unsynced-item-1",
          saleMovementId: "inv-unsynced-move-1",
          openPackMovementId: null,
          productId: "p-synced",
          batchId: "b-synced",
          quantity: 1,
          quantityType: "pack",
          salePrice: 150,
          packsOpened: 0,
        },
      ],
    });
  });

  it("keeps undecodable legacy entries for the report instead of dropping them", () => {
    const archive = {
      ...legacyArchive(databaseName),
      databases: [
        {
          ...legacyArchive(databaseName).databases[0]!,
          crud: [...crudRows, { id: 99, tx_id: 99, data: "{not json" }],
        },
      ],
      saleOutbox: [{ key: "tabaaq.sale-outbox.org_e2e1", value: '{"cmd-x":{"command":{}}}' }],
    };
    const changes = extractLegacyChanges(archive);
    expect(changes.undecodable.map((entry) => [entry.source, entry.reference])).toEqual([
      ["crud", "99"],
      ["saleOutbox", "tabaaq.sale-outbox.org_e2e1/cmd-x"],
    ]);
  });
});

describe("legacy migration plan", () => {
  it("merges legacy writes onto the current replica and skips what already synced", async () => {
    const replica = await openServerReplica();
    const { decisions } = await planAgainst(replica);
    expect(decisions.map((decision) => decision.legacy)).toMatchObject(
      PLANNED_ORDER.map((id) => (id.startsWith("inv-") ? { invoiceId: id } : { rowId: id })),
    );

    const category = enqueued(byLegacyRow(decisions, "c-new"));
    expect(category.command).toMatchObject({
      _tag: "catalogWrite",
      payload: {
        commandId: category.operationId,
        deviceId: "replica-1",
        occurredAt: T0 + 2_000,
        writes: [
          {
            entity: "category",
            action: "upsert",
            id: "c-new",
            expectedRowVersion: null,
            row: { name: "Syrups", tracksPacks: true },
          },
        ],
      },
    });
    expect(category.operationId).toMatch(/^legacy-[0-9a-f]{64}$/u);

    const batch = enqueued(byLegacyRow(decisions, "b-new"));
    expect(batch.command).toMatchObject({
      payload: {
        writes: [
          {
            entity: "batch",
            action: "upsert",
            id: "b-new",
            expectedRowVersion: null,
            note: LEGACY_CARRY_OVER_NOTE,
            movementId: expect.stringMatching(/^legacy-[0-9a-f]{64}$/u),
            row: { productId: "p-new", packQuantity: 3, unitQuantity: 0, expiresAt: 1788536000000 },
          },
        ],
      },
    });

    const product = enqueued(byLegacyRow(decisions, "p-synced"));
    expect(product.command).toMatchObject({
      payload: {
        writes: [
          {
            entity: "product",
            action: "upsert",
            id: "p-synced",
            expectedRowVersion: 4,
            row: { name: "Panadol Extra", retailPrice: 150, purchasePrice: 100, unitsPerPack: 10 },
          },
        ],
      },
    });

    const adjusted = enqueued(byLegacyRow(decisions, "b-synced"));
    expect(adjusted.command).toMatchObject({
      payload: {
        writes: [
          {
            entity: "batch",
            id: "b-synced",
            expectedRowVersion: 5,
            row: { packQuantity: 4, unitQuantity: 0 },
          },
        ],
      },
    });

    expect(byLegacyRow(decisions, "c-gone")).toMatchObject({
      _tag: "skipped",
      reason: "rowMissing",
    });
    expect(byLegacyRow(decisions, "inv-synced")).toMatchObject({
      _tag: "skipped",
      reason: "syncedByPreviousVersion",
    });
    expect(byLegacyRow(decisions, "inv-server")).toMatchObject({
      _tag: "skipped",
      reason: "alreadySynced",
    });
    const sale = enqueued(byLegacyRow(decisions, "inv-unsynced"));
    expect(sale.operationId).toBe("cmd-unsynced");
    expect(sale.command).toMatchObject({
      _tag: "issueInvoice",
      payload: { commandId: "cmd-unsynced", invoiceId: "inv-unsynced", invoiceNumber: 4 },
    });
    expect(decisions.map((decision) => decision.kind)).toEqual([
      "catalog",
      "catalog",
      "catalog",
      "catalog",
      "catalog",
      "catalog",
      "sale",
      "sale",
      "sale",
    ]);
    replica.close();
  });

  it("treats a PUT of an existing row as a field patch and skips no-op patches", async () => {
    const replica = await openServerReplica();
    const archive = legacyArchive(databaseName);
    const database = archive.databases[0]!;
    const putExisting = {
      id: 30,
      tx_id: 30,
      data: JSON.stringify({
        op: "PUT",
        id: "c-synced",
        type: "categories",
        data: { name: "Tablets", tracksPacks: 0, organizationId: ORGANIZATION_ID, rowVersion: 1 },
      }),
    };
    const noOpPatch = {
      id: 31,
      tx_id: 31,
      data: JSON.stringify({
        op: "PATCH",
        id: "p-synced",
        type: "products",
        data: { rowVersion: 9, updatedAt: T0 },
        old: { rowVersion: 8 },
      }),
    };
    const { decisions } = await planAgainst(replica, {
      ...archive,
      databases: [{ ...database, crud: [putExisting, noOpPatch] }],
      saleOutbox: [],
    });
    expect(decisions).toHaveLength(2);
    expect(enqueued(decisions[0]).command).toMatchObject({
      payload: {
        writes: [
          {
            entity: "category",
            id: "c-synced",
            expectedRowVersion: 3,
            row: { name: "Tablets", tracksPacks: false },
          },
        ],
      },
    });
    expect(decisions[1]).toMatchObject({ _tag: "skipped", reason: "noChanges" });
    replica.close();
  });

  it("is idempotent: a re-run after enqueueing only reports queued operations", async () => {
    const replica = await openServerReplica();
    const first = await planAgainst(replica);
    for (const decision of first.decisions) {
      if (decision._tag === "enqueue") await Effect.runPromise(first.port.enqueue(decision));
    }
    const statuses = await replica.readOutboxStatuses();
    expect(statuses).toHaveLength(6);

    const second = await planAgainst(replica);
    expect(second.decisions.map((decision) => [decision.operationId, decision._tag])).toEqual(
      first.decisions.map((decision) => [
        decision.operationId,
        decision._tag === "enqueue" ? "queued" : decision._tag,
      ]),
    );
    expect(await replica.readOutboxStatuses()).toHaveLength(6);
    replica.close();
  });
});
