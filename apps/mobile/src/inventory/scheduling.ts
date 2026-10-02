import type { SqlClientReplicaHandle } from "@store/client-db/sql-client";
import type { LiveNetworkSignal } from "@store/sync";
import * as Network from "expo-network";
import * as React from "react";
import { AppState } from "react-native";

const isReachable = (state: Network.NetworkState): boolean =>
  state.isInternetReachable ?? state.isConnected ?? false;

const METERED_PULL_MAX_BYTES = 262_144;

const METERED_NETWORK_TYPES: ReadonlySet<string> = new Set(["CELLULAR", "BLUETOOTH"]);

const pullMaxBytesFor = (state: Network.NetworkState): number | undefined =>
  state.type !== undefined && METERED_NETWORK_TYPES.has(state.type)
    ? METERED_PULL_MAX_BYTES
    : undefined;

let lastReachable = true;

export const expoNetworkSignal: LiveNetworkSignal = {
  isOnline: () => lastReachable,
  subscribe: (listener) => {
    const subscription = Network.addNetworkStateListener((state) => {
      lastReachable = isReachable(state);
      listener(lastReachable);
    });
    return () => subscription.remove();
  },
};

const ignoreFailure = (work: Promise<void>) => {
  work.catch(() => undefined);
};

export const applyAppState = (handle: SqlClientReplicaHandle, state: string) => {
  if (state === "active") {
    ignoreFailure(handle.setVisible(true).then(() => handle.wakeSync("focus")));
  } else if (state === "background") {
    ignoreFailure(handle.setVisible(false));
  }
};

export const applyPullMaxBytes = (handle: SqlClientReplicaHandle, maxBytes: number | undefined) => {
  ignoreFailure(handle.setPullMaxBytes(maxBytes));
};

export const useReplicaScheduling = (
  active: React.RefObject<SqlClientReplicaHandle | undefined>,
): React.RefObject<number | undefined> => {
  const pullMaxBytes = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    let reachable: boolean | undefined;
    let mounted = true;
    const adoptPullMaxBytes = (state: Network.NetworkState) => {
      const next = pullMaxBytesFor(state);
      if (next === pullMaxBytes.current) return;
      pullMaxBytes.current = next;
      const handle = active.current;
      if (handle) applyPullMaxBytes(handle, next);
    };
    const appState = AppState.addEventListener("change", (state) => {
      const handle = active.current;
      if (handle) applyAppState(handle, state);
    });
    const network = Network.addNetworkStateListener((state) => {
      const next = isReachable(state);
      const wake = reachable === false && next;
      reachable = next;
      adoptPullMaxBytes(state);
      const handle = active.current;
      if (wake && handle) ignoreFailure(handle.wakeSync("reconnect"));
    });
    Network.getNetworkStateAsync().then(
      (state) => {
        if (!mounted) return;
        if (reachable === undefined) reachable = isReachable(state);
        adoptPullMaxBytes(state);
      },
      () => undefined,
    );
    return () => {
      mounted = false;
      appState.remove();
      network.remove();
    };
  }, [active]);
  return pullMaxBytes;
};
