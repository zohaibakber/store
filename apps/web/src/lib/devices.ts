import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { DeviceCommand, OrganizationDevice } from "@store/contracts";
import { useInventoryState } from "@store/inventory-react";
import { Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as React from "react";

import { appHost } from "@/host";
import { storeErrorMessage, toastStoreError } from "@/lib/errors";

const LOAD_FAILED = "Couldn't load the devices.";

const organizationDevicesAtom = Atom.make(
  Effect.tryPromise({
    try: () => appHost().devices.list(),
    catch: (cause) => storeErrorMessage(cause, LOAD_FAILED),
  }),
);

type OrganizationDevicesState = {
  readonly devices: ReadonlyArray<OrganizationDevice> | null;
  readonly error: string | null;
};

export const useOrganizationDevices = () => {
  const result = useAtomValue(organizationDevicesAtom);
  const reload = useAtomRefresh(organizationDevicesAtom);
  const inventory = useInventoryState();
  const syncNow = inventory._tag === "Ready" ? inventory.actions.syncNow : undefined;

  const command = React.useCallback(
    async (deviceCommand: DeviceCommand) => {
      try {
        await appHost().devices.command(deviceCommand);
        reload();
        syncNow?.();
        return true;
      } catch (cause) {
        toastStoreError(cause);
        return false;
      }
    },
    [reload, syncNow],
  );

  const state: OrganizationDevicesState = AsyncResult.matchWithError(result, {
    onInitial: () => ({ devices: null, error: null }),
    onSuccess: (success) => ({ devices: success.value.devices, error: null }),
    onError: (error) => ({ devices: null, error }),
    onDefect: (defect) => ({ devices: null, error: storeErrorMessage(defect, LOAD_FAILED) }),
  });

  return {
    ...state,
    thisDeviceId: inventory._tag === "Ready" ? inventory.inventory.deviceId : null,
    reload,
    command,
  };
};
