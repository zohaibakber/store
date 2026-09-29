import { useInventoryState, type Inventory } from "@store/inventory-react";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import * as React from "react";

import { toastManager } from "@/components/ui/toast";
import { reportError } from "@/lib/report-error";

import type { LegacyMigrationBridge } from "../../../electron/legacy-migration-channels";
import { bridgeLegacyFiles, browserLegacyStore, replicaLegacyPort } from "./browser";
import type { LegacyMigrationNotice } from "./model";
import { runLegacyMigration } from "./run";

const migrationPermit = Semaphore.makeUnsafe(1);

const changes = (count: number) => (count === 1 ? "1 change" : `${count} changes`);

type LegacyMigrationToast = {
  readonly title: string;
  readonly description?: string;
  readonly type: "success" | "warning";
};

const unsyncedChanges = (count: number) =>
  count === 1 ? "1 unsynced change" : `${count} unsynced changes`;

const legacyMigrationToast = (notice: LegacyMigrationNotice): LegacyMigrationToast => {
  if (notice.carriedOver === 0) {
    return {
      title: `${changes(notice.rejected)} from the previous version could not be applied`,
      type: "warning",
    };
  }
  const title = `Carried over ${unsyncedChanges(notice.carriedOver)} from the previous version`;
  if (notice.rejected === 0) return { title, type: "success" };
  return {
    title,
    description: `${changes(notice.rejected)} could not be applied.`,
    type: "warning",
  };
};

export const startLegacyMigration = (input: {
  readonly bridge: LegacyMigrationBridge;
  readonly inventory: Pick<Inventory, "replica" | "actor">;
  readonly apiBaseUrl: string;
}) =>
  migrationPermit.withPermit(
    runLegacyMigration({
      identity: {
        organizationId: input.inventory.actor.organizationId,
        userId: input.inventory.actor.userId,
        replicaId: input.inventory.actor.deviceId,
      },
      apiBaseUrl: input.apiBaseUrl,
      legacy: browserLegacyStore(globalThis.indexedDB, globalThis.localStorage),
      files: bridgeLegacyFiles(input.bridge),
      replica: replicaLegacyPort(input.inventory.replica, input.inventory.actor),
      notify: (notice) => Effect.sync(() => toastManager.add(legacyMigrationToast(notice))),
      report: (cause, op) =>
        Effect.sync(() =>
          reportError(cause, { op, scopeId: input.inventory.actor.organizationId }),
        ),
    }).pipe(
      Effect.catch((failure) =>
        Effect.sync(() =>
          reportError(failure, {
            op: `legacy-migration-${failure.step}`,
            scopeId: input.inventory.actor.organizationId,
          }),
        ),
      ),
    ),
  );

export function LegacyMigrationRunner({ apiBaseUrl }: { readonly apiBaseUrl: string }) {
  const state = useInventoryState();
  const inventory = state._tag === "Ready" ? state.inventory : null;
  React.useEffect(() => {
    const bridge = globalThis.window?.legacyMigration;
    if (inventory === null || bridge === undefined) return;
    const fiber = Effect.runFork(startLegacyMigration({ bridge, inventory, apiBaseUrl }));
    return () => {
      fiber.interruptUnsafe();
    };
  }, [apiBaseUrl, inventory]);
  return null;
}
