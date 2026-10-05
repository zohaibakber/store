import {
  InventoryProvider as SharedInventoryProvider,
  useInventoryState,
  type CatalogLease,
  type CatalogLifetime,
  type InventoryHost,
} from "@store/inventory-react";
import type * as React from "react";

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
  return children;
}
