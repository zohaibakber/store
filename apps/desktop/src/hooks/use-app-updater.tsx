import { useEffect, useRef } from "react";
import { toastManager } from "@/components/ui/toast";

const UPDATE_AVAILABLE_TOAST_ID = "app-update-available";

const startDownload = (version: string) => {
  void toastManager
    .promise(window.updater.download(), {
      error: (error) => ({
        description: error instanceof Error ? error.message : "Please try again.",
        priority: "high",
        title: "Update failed",
        type: "error",
      }),
      loading: {
        description: `Downloading version ${version}.`,
        timeout: 0,
        title: "Downloading update…",
        type: "loading",
      },
      success: {
        actionProps: {
          children: "Restart now",
          onClick: () => window.updater.install(),
        },
        description: `Restart to install version ${version}.`,
        timeout: 0,
        title: "Update ready",
        type: "success",
      },
    })
    .catch(() => {
      // The promise toast renders the rejected download state.
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
          break;
        case "downloaded":
          downloadingRef.current = false;
          break;
        case "error":
          if (!downloadingRef.current) {
            toastManager.add({
              description: event.message,
              priority: "high",
              title: "Update check failed",
              type: "error",
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
