import {
  type CatalogPullRequest,
  type CatalogPullResult,
  type CatalogSnapshotRequest,
  type CatalogSnapshotResult,
} from "@store/contracts";
import { InventoryHyperdrive } from "@store/db/postgres/infra";
import { catalogNotificationOutbox } from "@store/db/postgres/schema";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Postgres from "alchemy/SQL/Postgres";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { bootstrapCatalog, expireBootstraps } from "./bootstrap";
import { pullCatalogChanges } from "./catalog-log";
import { makeInventoryMutationDatabase, type InventoryMutationWriter } from "./catalog-write";
import { InventoryDatabaseError } from "./errors";
import { makeInventoryImportCommandDatabase } from "./import-inventory";
import { makeInvoiceCommandDatabase } from "./issue-invoice";
import { makePostgresDrizzle, catalogReadError } from "./postgres";

export class InventoryMutationDatabase extends Context.Service<
  InventoryMutationDatabase,
  {
    readonly expireBootstraps: Effect.Effect<void, InventoryDatabaseError>;
    readonly pendingNotifications: Effect.Effect<
      ReadonlyArray<{ organizationId: string; cursor: number }>,
      InventoryDatabaseError
    >;
    readonly acknowledgeNotification: (
      organizationId: string,
      cursor: number,
    ) => Effect.Effect<void, InventoryDatabaseError>;
    readonly write: InventoryMutationWriter;
    readonly importInventory: ReturnType<typeof makeInventoryImportCommandDatabase>;
    readonly issueInvoice: ReturnType<typeof makeInvoiceCommandDatabase>;
    readonly pull: (
      organizationId: string,
      request: CatalogPullRequest,
    ) => Effect.Effect<CatalogPullResult, InventoryDatabaseError>;
    readonly snapshot: (
      organizationId: string,
      request: CatalogSnapshotRequest,
    ) => Effect.Effect<CatalogSnapshotResult, InventoryDatabaseError>;
  }
>()("@store/server/InventoryMutationDatabase") {}

export const InventoryMutationDatabaseLive = Layer.effect(
  InventoryMutationDatabase,
  Effect.gen(function* () {
    const inventoryHyperdrive = yield* InventoryHyperdrive;
    const hyperdrive = yield* Cloudflare.Hyperdrive.Connect(inventoryHyperdrive);
    const postgres = yield* Postgres.Postgres({
      url: hyperdrive.connectionString,
      maxConnections: 1,
      applicationName: "tabaaq-inventory-mutations",
    });
    const db = yield* makePostgresDrizzle(postgres);
    return InventoryMutationDatabase.of({
      expireBootstraps: Effect.suspend(() => expireBootstraps(db)).pipe(
        Effect.mapError(catalogReadError),
      ),
      pendingNotifications: db
        .select()
        .from(catalogNotificationOutbox)
        .limit(100)
        .pipe(Effect.mapError(catalogReadError)),
      acknowledgeNotification: (organizationId, cursor) =>
        db
          .delete(catalogNotificationOutbox)
          .where(
            and(
              eq(catalogNotificationOutbox.organizationId, organizationId),
              eq(catalogNotificationOutbox.cursor, cursor),
            ),
          )
          .pipe(Effect.asVoid, Effect.mapError(catalogReadError)),
      write: makeInventoryMutationDatabase(db),
      importInventory: makeInventoryImportCommandDatabase(db),
      issueInvoice: makeInvoiceCommandDatabase(db),
      pull: Effect.fn("InventoryMutationDatabase.pull")(function* (
        organizationId: string,
        request: CatalogPullRequest,
      ) {
        return yield* pullCatalogChanges(db, organizationId, request).pipe(
          Effect.mapError(catalogReadError),
        );
      }),
      snapshot: Effect.fn("InventoryMutationDatabase.snapshot")(function* (
        organizationId: string,
        request: CatalogSnapshotRequest,
      ) {
        return yield* bootstrapCatalog(db, organizationId, request).pipe(
          Effect.mapError(catalogReadError),
        );
      }),
    });
  }),
);
