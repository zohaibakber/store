import {
  InventoryProvider as SharedInventoryProvider,
  useInventoryState,
  useInventorySyncActivity,
  useInventorySyncStatus,
  type CatalogLease,
  type CatalogLifetime,
  type InventoryHost,
} from "@store/inventory-react";
import type * as React from "react";

import { FirstSync } from "@/components/app/first-sync";
import { PageLoading } from "@/components/app/loading-spinner";

export function InventoryProvider({
  children,
  catalog,
  host,
  lease,
}: {
  readonly children: React.ReactNode;
  readonly catalog: CatalogLifetime;
  readonly host: InventoryHost;
  readonly lease: CatalogLease;
}) {
  return (
    <SharedInventoryProvider catalog={catalog} host={host} lease={lease} scope={lease.scope}>
      <InventoryOpenFailure>{children}</InventoryOpenFailure>
    </SharedInventoryProvider>
  );
}

function InventoryOpenFailure({ children }: { readonly children: React.ReactNode }) {
  const state = useInventoryState();
  if (state._tag !== "Error") return children;
  return (
    <div className="flex flex-col gap-3 p-6">
      <p className="text-sm text-destructive">{state.error}</p>
      <button className="text-sm underline" onClick={state.retry} type="button">
        Try again
      </button>
    </div>
  );
}

export function InventoryReady({ children }: { readonly children: React.ReactNode }) {
  const state = useInventoryState();
  if (state._tag !== "Ready") return <PageLoading />;
  return <FirstSyncGate>{children}</FirstSyncGate>;
}

const HALTED_SYNC: ReadonlySet<string> = new Set([
  "storageError",
  "updateRequired",
  "recoveryRequired",
]);

export const useFirstSyncPending = () => {
  const { firstSyncPending } = useInventorySyncActivity();
  const status = useInventorySyncStatus();
  return firstSyncPending && !HALTED_SYNC.has(status._tag);
};

function FirstSyncGate({ children }: { readonly children: React.ReactNode }) {
  if (useFirstSyncPending()) return <FirstSync />;
  return children;
}
