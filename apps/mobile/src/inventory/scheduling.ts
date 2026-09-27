import type { SqlClientReplicaHandle } from "@store/client-db/sql-client";
import * as Network from "expo-network";
import * as React from "react";
import { AppState } from "react-native";

import { isReachable, reconnected, visibilityForAppState } from "./policy";

const ignoreFailure = (work: Promise<void>) => {
  work.catch(() => undefined);
};

export const applyAppState = (handle: SqlClientReplicaHandle, state: string) => {
  switch (visibilityForAppState(state)) {
    case "foreground":
      ignoreFailure(handle.setVisible(true).then(() => handle.wakeSync("focus")));
      return;
    case "background":
      ignoreFailure(handle.setVisible(false));
      return;
    case "unchanged":
      return;
  }
};

export const useReplicaScheduling = (
  active: React.RefObject<SqlClientReplicaHandle | undefined>,
) => {
  React.useEffect(() => {
    let reachable: boolean | undefined;
    let mounted = true;
    const appState = AppState.addEventListener("change", (state) => {
      const handle = active.current;
      if (handle) applyAppState(handle, state);
    });
    const network = Network.addNetworkStateListener((state) => {
      const next = isReachable(state);
      const wake = reconnected(reachable, next);
      reachable = next;
      const handle = active.current;
      if (wake && handle) ignoreFailure(handle.wakeSync("reconnect"));
    });
    Network.getNetworkStateAsync().then(
      (state) => {
        if (mounted && reachable === undefined) reachable = isReachable(state);
      },
      () => undefined,
    );
    return () => {
      mounted = false;
      appState.remove();
      network.remove();
    };
  }, [active]);
};
