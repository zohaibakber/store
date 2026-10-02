import { RegistryContext } from "@effect/atom-react";
import { classifyUpdateFailure, updateFailureMessage } from "@store/contracts";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { useContext, useEffect } from "react";

import { toastManager } from "@/components/ui/toast";
import { appHost } from "@/host";

const UPDATE_AVAILABLE_TOAST_ID = "app-update-available";
const UPDATE_DOWNLOAD_TOAST_ID = "app-update-download";
const UPDATE_CHECK_TOAST_ID = "app-update-check";

const toastManualUpdateCheckAtom = Atom.make(false).pipe(Atom.keepAlive);

const claimManualUpdateCheck = (registry: AtomRegistry.AtomRegistry) => {
  if (!registry.get(toastManualUpdateCheckAtom)) return false;
  registry.set(toastManualUpdateCheckAtom, false);
  return true;
};

const showDownloadProgress = (value: number, description: string) => {
  toastManager.add({
    data: {
      progress: {
        label: "Downloading update…",
        value,
      },
    },
    description,
    id: UPDATE_DOWNLOAD_TOAST_ID,
    timeout: 0,
    title: "Downloading update…",
    type: "loading",
  });
};

const startDownload = (version: string) => {
  const updater = appHost().updater;
  if (!updater) return;
  showDownloadProgress(0, `Downloading version ${version}.`);
  void updater
    .download()
    .then(() => {
      toastManager.add({
        actionProps: {
          children: "Restart now",
          onClick: () => updater.install(),
        },
        data: {},
        description: `Restart to install version ${version}.`,
        id: UPDATE_DOWNLOAD_TOAST_ID,
        timeout: 0,
        title: "Update ready",
        type: "success",
      });
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : "";
      const offline = classifyUpdateFailure(message) === "network";
      toastManager.add({
        data: {},
        description: offline
          ? "The download will continue when you're back online."
          : updateFailureMessage(message),
        id: UPDATE_DOWNLOAD_TOAST_ID,
        priority: offline ? undefined : "high",
        title: offline ? "You're offline" : "Update failed",
        type: offline ? "info" : "error",
        timeout: offline ? undefined : 0,
      });
    });
};

export const canCheckForAppUpdate = () => Boolean(appHost().updater);

const checkForAppUpdate = (registry: AtomRegistry.AtomRegistry) => {
  const updater = appHost().updater;
  if (!updater) return;
  registry.set(toastManualUpdateCheckAtom, true);
  toastManager.add({
    id: UPDATE_CHECK_TOAST_ID,
    timeout: 0,
    title: "Checking for updates…",
    type: "loading",
  });
  void updater.check().catch((error) => {
    if (!claimManualUpdateCheck(registry)) return;
    const message = error instanceof Error ? error.message : "";
    const offline = classifyUpdateFailure(message) === "network";
    toastManager.add({
      description: offline
        ? "Tabaaq will check for updates when you're back online."
        : updateFailureMessage(message),
      id: UPDATE_CHECK_TOAST_ID,
      priority: offline ? undefined : "high",
      title: offline ? "You're offline" : "Update check failed",
      type: offline ? "info" : "error",
    });
  });
};

export const useCheckForAppUpdate = () => {
  const registry = useContext(RegistryContext);
  return () => checkForAppUpdate(registry);
};

export function useAppUpdater() {
  const registry = useContext(RegistryContext);
  useEffect(() => {
    const updater = appHost().updater;
    if (!updater) return;

    const unsubscribe = updater.onEvent((event) => {
      switch (event.type) {
        case "available":
          registry.set(toastManualUpdateCheckAtom, false);
          toastManager.close(UPDATE_CHECK_TOAST_ID);
          toastManager.add({
            id: UPDATE_AVAILABLE_TOAST_ID,
            title: "Update available",
            description: `Version ${event.version} is ready to download.`,
            timeout: 0,
            actionProps: {
              children: "Download",
              onClick: () => {
                toastManager.close(UPDATE_AVAILABLE_TOAST_ID);
                startDownload(event.version);
              },
            },
          });
          break;
        case "not-available":
          if (claimManualUpdateCheck(registry)) {
            toastManager.add({
              description: `Version ${__APP_VERSION__} is the latest.`,
              id: UPDATE_CHECK_TOAST_ID,
              title: "You're up to date",
              type: "success",
            });
          }
          break;
        case "progress":
          showDownloadProgress(event.percent, "Almost ready to install.");
          break;
        case "error":
          if (!claimManualUpdateCheck(registry)) break;
          if (event.failure === "network") {
            toastManager.add({
              description: "Tabaaq will check for updates when you're back online.",
              id: UPDATE_CHECK_TOAST_ID,
              title: "You're offline",
              type: "info",
            });
            break;
          }
          toastManager.add({
            description: event.message,
            id: UPDATE_CHECK_TOAST_ID,
            priority: event.retrying ? undefined : "high",
            title: event.retrying ? "Update check delayed" : "Update check failed",
            type: event.retrying ? "info" : "error",
          });
          break;
        case "checking":
        case "downloaded":
          break;
        default: {
          const _exhaustive: never = event;
          void _exhaustive;
        }
      }
    });

    return unsubscribe;
  }, [registry]);
}
