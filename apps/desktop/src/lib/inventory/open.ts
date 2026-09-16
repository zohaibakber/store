import {
  DEFAULT_COLLECTION_MAXIMUM_ROWS,
  decodeBatchSqliteRows,
  decodeCategorySqliteRows,
  decodeInvoiceItemSqliteRows,
  decodeInvoiceSqliteRows,
  decodeProductSqliteRows,
  decodeStockMovementSqliteRows,
  inventoryOrganizationObjectReplicaName,
  inventoryReplicaScope,
  sqliteCollectionOptions,
  syncStatusFromOutbox,
  createSyncStatusStore,
  decodeOutboxStatusRow,
  connectOrganizationObjectLiveTransport,
  type InventoryCollectionDescriptor,
  type InventoryCollectionRow,
  type InventorySyncStatus,
  type OrganizationObjectLiveTransport,
  type ReplicaLiveFeed,
  type ReplicaSqliteHandle,
} from "@store/client-db";
import {
  StockRecommendationService,
  stockRecommendationLayer,
} from "@store/services/stock-recommendations";
import { collectionOptions, DbClient } from "@tanstack/react-db";
import { Effect, ManagedRuntime } from "effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { HostInventoryScope } from "@/host-access";
import type { InventoryHost } from "@/lib/inventory-host";

import { makeInventoryActions } from "./actions";
import type { Inventory, InventoryActor } from "./types";

export const inventoryScopeId = (host: InventoryHost, scope: HostInventoryScope) =>
  inventoryReplicaScope(host.apiBaseUrl, scope.organizationId);

const actorFor = (host: InventoryHost, scope: HostInventoryScope): InventoryActor => ({
  organizationId: scope.organizationId,
  userId: scope.userId,
  deviceId: host.deviceId,
});

const recommendStockFor = (scope: HostInventoryScope) => {
  const recommendations = ManagedRuntime.make(stockRecommendationLayer);
  return {
    recommendStock: (snapshot: Parameters<Inventory["recommendStock"]>[0], signal: AbortSignal) =>
      recommendations.runPromise(
        Effect.gen(function* () {
          const service = yield* StockRecommendationService;
          return yield* service.analyze({ ...snapshot, organizationId: scope.organizationId });
        }).pipe(Effect.result),
        { signal },
      ),
    disposeRecommendations: () => recommendations.dispose(),
  };
};

const replicaDescriptor = <Row extends InventoryCollectionRow>(
  id: string,
  source: InventoryCollectionDescriptor<Row>["source"],
  syncMode: InventoryCollectionDescriptor<Row>["syncMode"],
  decodeRows: InventoryCollectionDescriptor<Row>["decodeRows"],
): InventoryCollectionDescriptor<Row> => ({
  id,
  source,
  syncMode,
  maximumRows: DEFAULT_COLLECTION_MAXIMUM_ROWS,
  getKey: (row) => row.id,
  decodeRows,
});

const outboxStatus = async (replica: ReplicaSqliteHandle): Promise<InventorySyncStatus> => {
  const statuses = (await replica.query(`select status from command_outbox`, [])).flatMap((row) => {
    const decoded = decodeOutboxStatusRow(row);
    return Option.isSome(decoded) ? [decoded.value.status] : [];
  });
  return syncStatusFromOutbox(statuses);
};

export const openInventoryWorkspace = async (
  host: InventoryHost,
  scope: HostInventoryScope,
): Promise<Inventory> => {
  const scopeId = inventoryScopeId(host, scope);
  const replica = await host.openReplicaSqlite(inventoryOrganizationObjectReplicaName(scopeId));
  await replica.query(
    `update replica_state set organizationId = ?, userId = ?, replicaId = ? where id = 'singleton'`,
    [scope.organizationId, scope.userId, host.deviceId],
  );
  const dbClient = new DbClient();
  const collections = {
    categories: dbClient.collection(
      collectionOptions(
        sqliteCollectionOptions(
          replicaDescriptor(
            `${scopeId}:categories`,
            "categories",
            "eager",
            decodeCategorySqliteRows,
          ),
          { executor: replica, changeFeed: replica },
        ),
      ),
    ),
    products: dbClient.collection(
      collectionOptions(
        sqliteCollectionOptions(
          replicaDescriptor(
            `${scopeId}:products`,
            "products",
            "on-demand",
            decodeProductSqliteRows,
          ),
          { executor: replica, changeFeed: replica },
        ),
      ),
    ),
    batches: dbClient.collection(
      collectionOptions(
        sqliteCollectionOptions(
          replicaDescriptor(`${scopeId}:batches`, "batches", "on-demand", decodeBatchSqliteRows),
          { executor: replica, changeFeed: replica },
        ),
      ),
    ),
    invoices: dbClient.collection(
      collectionOptions(
        sqliteCollectionOptions(
          replicaDescriptor(
            `${scopeId}:invoices`,
            "invoices",
            "on-demand",
            decodeInvoiceSqliteRows,
          ),
          { executor: replica, changeFeed: replica },
        ),
      ),
    ),
    invoiceItems: dbClient.collection(
      collectionOptions(
        sqliteCollectionOptions(
          replicaDescriptor(
            `${scopeId}:invoice-items`,
            "invoiceItems",
            "on-demand",
            decodeInvoiceItemSqliteRows,
          ),
          { executor: replica, changeFeed: replica },
        ),
      ),
    ),
    stockMovements: dbClient.collection(
      collectionOptions(
        sqliteCollectionOptions(
          replicaDescriptor(
            `${scopeId}:stock-movements`,
            "stockMovements",
            "on-demand",
            decodeStockMovementSqliteRows,
          ),
          { executor: replica, changeFeed: replica },
        ),
      ),
    ),
  };
  const { recommendStock, disposeRecommendations } = recommendStockFor(scope);
  const status = createSyncStatusStore(await outboxStatus(replica));
  const unsubscribeStatus = replica.subscribe((notice) => {
    if (notice.workspaceToken !== replica.workspaceToken) return;
    void outboxStatus(replica).then(status.set);
  });
  const tables = { dbClient, ...collections };
  const actor = actorFor(host, scope);
  let live: OrganizationObjectLiveTransport | undefined;
  const openSocket = host.openLiveSocket;
  if (openSocket) {
    const appliedRows = await replica.query(
      `select appliedCommitSequence from replica_state where id = 'singleton'`,
      [],
    );
    const applied = appliedRows[0]?.appliedCommitSequence;
    let appliedCursor = Schema.is(Schema.String)(applied) ? applied : "0";
    let feed: ReplicaLiveFeed = {
      _tag: "catchingUp",
      targetCommitSequence: appliedCursor,
    };
    void connectOrganizationObjectLiveTransport(
      host.authenticatedFetch,
      host.apiBaseUrl,
      host.deviceId,
      {
        feed: () => feed,
        appliedCursor: () => appliedCursor,
        applyTransactions: () => false,
        applyReceipt: () => undefined,
        resumeFromCursor: (cursor) => {
          appliedCursor = cursor;
          feed = { _tag: "catchingUp", targetCommitSequence: cursor };
        },
      },
      openSocket,
    )
      .then((transport) => {
        live = transport;
      })
      .catch(() => undefined);
  }
  return {
    ...tables,
    actions: makeInventoryActions(tables, host, actor, replica),
    commands: { status: status.get },
    sync: status.get(),
    observeSync: status.observe,
    recommendStock,
    dispose: async () => {
      live?.close();
      unsubscribeStatus();
      try {
        await disposeRecommendations();
        await dbClient.cleanup();
      } finally {
        replica.close();
      }
    },
  };
};

export const openInventory = openInventoryWorkspace;
