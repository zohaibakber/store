import type { SqlClientReplicaHandle } from "@store/client-db/sql-client";
import { InventoryProvider, type InventoryHost } from "@store/inventory-react";
import * as Option from "effect/Option";
import Constants from "expo-constants";
import * as React from "react";
import { AppState } from "react-native";

import { useSession, type SignedInSession } from "@/auth";

import { createMobileInventoryHost, unavailableInventoryHost } from "./host";
import { decodeMobileExtra } from "./policy";
import { applyAppState, useReplicaScheduling } from "./scheduling";

const apiBaseUrl = decodeMobileExtra(Constants.expoConfig?.extra).pipe(
  Option.map((extra) => extra.apiBaseUrl),
);

const idleSync = () => Promise.resolve();

const SyncNowContext = React.createContext<() => Promise<void>>(idleSync);

export const useSyncNow = (): (() => Promise<void>) => React.use(SyncNowContext);

const useLatest = <A,>(value: A): React.RefObject<A> => {
  const ref = React.useRef(value);
  React.useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
};

const unauthenticatedFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

function InventoryRoot({
  children,
  session,
}: {
  readonly children: React.ReactNode;
  readonly session: SignedInSession | null;
}) {
  const latestFetch = useLatest(session?.authenticatedFetch ?? unauthenticatedFetch);
  const active = React.useRef<SqlClientReplicaHandle | undefined>(undefined);
  useReplicaScheduling(active);

  const host = React.useMemo((): InventoryHost => {
    if (Option.isNone(apiBaseUrl)) {
      return unavailableInventoryHost({
        apiBaseUrl: "",
        message: "The inventory server address is not configured.",
      });
    }
    return createMobileInventoryHost({
      apiBaseUrl: apiBaseUrl.value,
      authenticatedFetch: (input, init) => latestFetch.current(input, init),
      listener: {
        opened: (handle) => {
          active.current = handle;
          applyAppState(handle, AppState.currentState ?? "");
        },
        closed: (handle) => {
          if (active.current === handle) active.current = undefined;
        },
      },
    });
  }, [latestFetch]);

  const syncNow = React.useCallback((): Promise<void> => {
    const handle = active.current;
    if (handle === undefined) return idleSync();
    return handle
      .setVisible(true)
      .then(() => handle.wakeSync("focus"))
      .catch(() => undefined);
  }, []);

  const organizationId = session?.organizationId ?? null;
  const userId = session?.userId ?? null;
  const scope = React.useMemo(
    () => (organizationId === null || userId === null ? null : { organizationId, userId }),
    [organizationId, userId],
  );

  return (
    <SyncNowContext value={syncNow}>
      <InventoryProvider host={scope === null ? null : host} scope={scope}>
        {children}
      </InventoryProvider>
    </SyncNowContext>
  );
}

export function MobileInventoryProvider({ children }: { readonly children: React.ReactNode }) {
  const session = useSession();
  return (
    <InventoryRoot session={session.status === "signedIn" ? session : null}>
      {children}
    </InventoryRoot>
  );
}
