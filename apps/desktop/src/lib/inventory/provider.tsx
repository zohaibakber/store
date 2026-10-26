import {
  InventoryProvider as SharedInventoryProvider,
  useInventoryState,
  useInventorySyncActivity,
  useInventorySyncStatus,
  type CatalogOpening,
  type InventorySyncStatus,
} from "@store/inventory-react";
import type * as React from "react";

import { FirstSync } from "@/components/app/first-sync";
import { PageLoading } from "@/components/app/loading-spinner";

export function InventoryProvider({
  children,
  opening,
}: {
  readonly children: React.ReactNode;
  readonly opening: CatalogOpening;
}) {
  return (
    <SharedInventoryProvider opening={opening}>
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

const isHalted = (status: InventorySyncStatus) => {
  switch (status._tag) {
    case "storageError":
    case "updateRequired":
    case "recoveryRequired":
    case "unavailable":
      return true;
    case "savedLocally":
    case "pendingConfirmation":
    case "caughtUp":
    case "rejected":
      return false;
  }
};

export const useFirstSyncPending = () => {
  const { firstSyncPending } = useInventorySyncActivity();
  const status = useInventorySyncStatus();
  return firstSyncPending && !isHalted(status);
};

function FirstSyncGate({ children }: { readonly children: React.ReactNode }) {
  if (useFirstSyncPending()) return <FirstSync />;
  return children;
}
