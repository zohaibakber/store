import { useEffect } from "react";

import { toastManager } from "@/components/ui/toast";

const UPDATE_AVAILABLE_TOAST_ID = "app-update-available";
const UPDATE_DOWNLOAD_TOAST_ID = "app-update-download";
const UPDATE_CHECK_TOAST_ID = "app-update-check";

let manualCheck = false;

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
  const updater = window.updater;
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
      toastManager.add({
        data: {},
        description: error instanceof Error ? error.message : "Please try again.",
        id: UPDATE_DOWNLOAD_TOAST_ID,
        priority: "high",
        title: "Update failed",
        type: "error",
        timeout: 0,
      });
    });
};

/** True when this build can ask the desktop updater for a newer package. */
export const canCheckForAppUpdate = () => Boolean(window.updater);

/** Ask the desktop updater for a newer package and surface the result in a toast. */
export const checkForAppUpdate = () => {
  const updater = window.updater;
  if (!updater) return;
  manualCheck = true;
  toastManager.add({
    id: UPDATE_CHECK_TOAST_ID,
    timeout: 0,
    title: "Checking for updates…",
    type: "loading",
  });
  void updater.check().catch((error) => {
    manualCheck = false;
    toastManager.add({
      description: error instanceof Error ? error.message : "Please try again.",
      id: UPDATE_CHECK_TOAST_ID,
      priority: "high",
      title: "Update check failed",
      type: "error",
    });
  });
};

export function useAppUpdater() {
  useEffect(() => {
    const updater = window.updater;
    if (!updater) return;

    const unsubscribe = updater.onEvent((event) => {
      switch (event.type) {
        case "available":
          manualCheck = false;
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
          if (manualCheck) {
            manualCheck = false;
            toastManager.add({
              description: `Version ${__APP_VERSION__} is the latest.`,
              id: UPDATE_CHECK_TOAST_ID,
              title: "You're up to date",
              type: "success",
            });
          }
          break;
        case "progress":
          showDownloadProgress(event.percent, "The update will be ready to install shortly.");
          break;
        case "error":
          if (manualCheck || !event.retrying) {
            manualCheck = false;
            toastManager.add({
              description: event.message,
              id: UPDATE_CHECK_TOAST_ID,
              priority: "high",
              title: event.retrying ? "Update check delayed" : "Update check failed",
              type: event.retrying ? "info" : "error",
            });
          }
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

    const requestCheck = () => void updater.check();
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") requestCheck();
    };

    window.addEventListener("focus", requestCheck);
    window.addEventListener("online", requestCheck);
    document.addEventListener("visibilitychange", checkWhenVisible);

    return () => {
      unsubscribe();
      window.removeEventListener("focus", requestCheck);
      window.removeEventListener("online", requestCheck);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, []);
}
