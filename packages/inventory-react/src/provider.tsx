import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { DbClient, DbProvider } from "@tanstack/react-db";
import { Cause, Effect, Exit, Schedule } from "effect";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import * as React from "react";

import type { InventoryHost, InventoryScope } from "./host";
import {
  createAppCatalogLifetime,
  StaleCatalogLease,
  type CatalogLease,
  type CatalogLifetime,
} from "./lifetime";
import type { InventoryState } from "./types";

const InventoryContext = React.createContext<InventoryState | null>(null);

const openRetrySchedule = Schedule.exponential("200 millis").pipe(
  Schedule.jittered,
  Schedule.upTo({ times: 3 }),
);

const openCatalog = (catalog: CatalogLifetime, lease: CatalogLease, host: InventoryHost) =>
  Effect.tryPromise({
    try: () => catalog.open(lease, host),
    catch: (cause) =>
      cause instanceof StaleCatalogLease
        ? cause
        : cause instanceof Error
          ? cause
          : new Error("Catalog storage is unavailable."),
  }).pipe(
    Effect.retry({
      schedule: openRetrySchedule,
      while: (cause) => !(cause instanceof StaleCatalogLease),
    }),
  );

const leaseMatches = (lease: CatalogLease | null, scope: InventoryScope): lease is CatalogLease =>
  lease !== null &&
  lease.scope.organizationId === scope.organizationId &&
  lease.scope.userId === scope.userId;

export type InventoryProviderProps = {
  readonly children: React.ReactNode;
  readonly host: InventoryHost | null;
  readonly scope: InventoryScope | null;
  readonly catalog?: CatalogLifetime;
};

export function InventoryProvider({ children, host, scope, catalog }: InventoryProviderProps) {
  const [ownedCatalog] = React.useState(createAppCatalogLifetime);
  const lifetime = catalog ?? ownedCatalog;
  const ownsLifetime = catalog === undefined;
  const claimed = catalog?.lease() ?? null;
  const organizationId = scope?.organizationId ?? null;
  const userId = scope?.userId ?? null;
  const [state, setState] = React.useState<InventoryState>({ _tag: "Opening" });
  const [attempt, setAttempt] = React.useState(0);
  const [idleRegistry] = React.useState(() => AtomRegistry.make());
  const [idleClient] = React.useState(() => new DbClient());
  const ready = state._tag === "Ready" ? state.inventory : null;

  React.useEffect(() => {
    if (host === null || organizationId === null || userId === null) {
      setState({ _tag: "Opening" });
      return;
    }
    let active = true;
    const requested = { organizationId, userId };
    const lease = leaseMatches(claimed, requested) ? claimed : lifetime.claim(requested);
    const retry = () => {
      setState({ _tag: "Opening" });
      setAttempt((value) => value + 1);
    };
    void Effect.runPromiseExit(openCatalog(lifetime, lease, host)).then((exit) => {
      if (!active) return;
      if (Exit.isSuccess(exit)) {
        setState({ _tag: "Ready", inventory: exit.value, actions: exit.value.actions });
        return;
      }
      if (Cause.hasInterrupts(exit.cause)) return;
      const failure = Cause.squash(exit.cause);
      if (failure instanceof StaleCatalogLease) return;
      const message =
        failure instanceof Error ? failure.message : "Catalog storage is unavailable.";
      setState({ _tag: "Error", error: message, retry });
    });
    return () => {
      active = false;
      if (ownsLifetime) lifetime.release();
    };
  }, [attempt, claimed, host, lifetime, organizationId, ownsLifetime, userId]);

  return (
    <InventoryContext.Provider value={state}>
      <RegistryContext.Provider value={ready?.atoms.registry ?? idleRegistry}>
        <DbProvider client={ready?.dbClient ?? idleClient}>{children}</DbProvider>
      </RegistryContext.Provider>
    </InventoryContext.Provider>
  );
}

export const useInventoryState = (): InventoryState => {
  const state = React.useContext(InventoryContext);
  if (!state) throw new Error("InventoryProvider is missing.");
  return state;
};

export const useInventoryActions = () => {
  const state = React.useContext(InventoryContext);
  if (!state || state._tag !== "Ready") throw new Error("Inventory is not ready.");
  return state.actions;
};

export const useCatalogReplica = () => {
  const state = React.useContext(InventoryContext);
  if (!state || state._tag !== "Ready") throw new Error("The catalog is not ready.");
  return state.inventory;
};

export const useCatalogIsReady = () => {
  const state = React.useContext(InventoryContext);
  return state?._tag === "Ready";
};

export const useCommandExecution = () => useAtomValue(useCatalogReplica().atoms.commandExecution);

export const useInventorySyncStatus = () => useAtomValue(useCatalogReplica().atoms.syncStatus);

export const useInventorySyncActivity = () => useAtomValue(useCatalogReplica().atoms.syncActivity);
