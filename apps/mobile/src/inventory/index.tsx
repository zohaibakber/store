import type { SqlClientReplicaHandle } from "@store/client-db/sql-client";
import { InventoryProvider, type InventoryHost } from "@store/inventory-react";
import * as Result from "effect/Result";
import * as React from "react";
import { AppState } from "react-native";

import { useSession, type SignedInSession } from "@/auth";
import { mobileConfig } from "@/config";

import { createMobileInventoryHost, unavailableInventoryHost } from "./host";
import {
  applyAppState,
  applyPullMaxBytes,
  expoNetworkSignal,
  useReplicaScheduling,
} from "./scheduling";

const apiBaseUrl = Result.getOrNull(mobileConfig)?.apiBaseUrl ?? null;

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

const noAccessToken = async (): Promise<string | null> => null;

function InventoryRoot({
  children,
  session,
}: {
  readonly children: React.ReactNode;
  readonly session: SignedInSession | null;
}) {
  const latestFetch = useLatest(session?.authenticatedFetch ?? unauthenticatedFetch);
  const latestAccessToken = useLatest(session?.liveAccessToken ?? noAccessToken);
  const active = React.useRef<SqlClientReplicaHandle | undefined>(undefined);
  const pullMaxBytes = useReplicaScheduling(active);

  const host = React.useMemo((): InventoryHost => {
    if (apiBaseUrl === null) {
      return unavailableInventoryHost({
        apiBaseUrl: "",
        message: "The inventory server address is not configured.",
      });
    }
    return createMobileInventoryHost({
      apiBaseUrl,
      authenticatedFetch: (input, init) => latestFetch.current(input, init),
      liveAccessToken: (options) => latestAccessToken.current(options),
      network: expoNetworkSignal,
      listener: {
        opened: (handle) => {
          active.current = handle;
          applyAppState(handle, AppState.currentState ?? "");
          applyPullMaxBytes(handle, pullMaxBytes.current);
        },
        closed: (handle) => {
          if (active.current === handle) active.current = undefined;
        },
      },
    });
  }, [latestFetch, latestAccessToken, pullMaxBytes]);

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
