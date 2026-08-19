import { useEffect } from "react";

import { toastManager } from "@/components/ui/toast";

const UPDATE_AVAILABLE_TOAST_ID = "app-update-available";
const UPDATE_DOWNLOAD_TOAST_ID = "app-update-download";

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

export function useAppUpdater() {
  useEffect(() => {
    const updater = window.updater;
    if (!updater) return;

    const unsubscribe = updater.onEvent((event) => {
      switch (event.type) {
        case "available":
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
        case "progress":
          showDownloadProgress(event.percent, "The update will be ready to install shortly.");
          break;
        case "error":
          toastManager.add({
            description: event.message,
            priority: "high",
            title: event.retrying ? "Update check delayed" : "Update check failed",
            type: event.retrying ? "info" : "error",
          });
          break;
        case "checking":
        case "not-available":
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
