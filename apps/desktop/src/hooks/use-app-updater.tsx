import { useEffect, useRef } from "react";
import { toastManager } from "@/components/ui/toast";

const UPDATE_AVAILABLE_TOAST_ID = "app-update-available";
const UPDATE_DOWNLOAD_TOAST_ID = "app-update-download";

const startDownload = (version: string) => {
  toastManager.add({
    data: {
      progress: {
        label: "Downloading",
        value: 0,
      },
    },
    description: `Downloading version ${version}.`,
    id: UPDATE_DOWNLOAD_TOAST_ID,
    timeout: 0,
    title: "Downloading update…",
    type: "loading",
  });

  void window.updater
    .download()
    .then(() => {
      toastManager.add({
        actionProps: {
          children: "Restart now",
          onClick: () => window.updater.install(),
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
  // Guards against a stray `available` event (e.g. a periodic background
  // check racing a download) resurfacing the "Download" action while a
  // download is already in flight.
  const downloadingRef = useRef(false);

  useEffect(() => {
    // The bridge is absent outside Electron (e.g. vitest with a bare jsdom).
    if (!window.updater) return;

    return window.updater.onEvent((event) => {
      switch (event.type) {
        case "available":
          if (downloadingRef.current) break;
          toastManager.add({
            id: UPDATE_AVAILABLE_TOAST_ID,
            title: "Update available",
            description: `Version ${event.version} is ready to download.`,
            timeout: 0,
            actionProps: {
              children: "Download",
              onClick: () => {
                downloadingRef.current = true;
                toastManager.close(UPDATE_AVAILABLE_TOAST_ID);
                startDownload(event.version);
              },
            },
          });
          break;
        case "progress":
          downloadingRef.current = true;
          toastManager.add({
            data: {
              progress: {
                label: "Downloading",
                value: event.percent,
              },
            },
            description: "The update will be ready to install shortly.",
            id: UPDATE_DOWNLOAD_TOAST_ID,
            timeout: 0,
            title: "Downloading update…",
            type: "loading",
          });
          break;
        case "downloaded":
          downloadingRef.current = false;
          break;
        case "error":
          if (!downloadingRef.current) {
            toastManager.add({
              description: event.message,
              priority: "high",
              title: event.retrying ? "Update check delayed" : "Update check failed",
              type: event.retrying ? "info" : "error",
            });
          }
          downloadingRef.current = false;
          break;
        default:
          break;
      }
    });
  }, []);
}
