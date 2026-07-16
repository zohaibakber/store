import { useEffect } from "react";
import { toast } from "sonner";

const UPDATE_TOAST_ID = "app-update";

const startDownload = (version: string) => {
  toast.loading(`Downloading version ${version}…`, {
    id: UPDATE_TOAST_ID,
    description: "Starting download",
    duration: Infinity,
  });
  void window.updater.download().catch(() => {
    // Failures are reported through the updater `error` event.
  });
};

export function useAppUpdater() {
  useEffect(() => {
    // The bridge is absent outside Electron (e.g. vitest with a bare jsdom).
    if (!window.updater) return;

    return window.updater.onEvent((event) => {
      switch (event.type) {
        case "available":
          toast(`Update available`, {
            id: UPDATE_TOAST_ID,
            description: `Version ${event.version} is ready to download.`,
            duration: Infinity,
            action: {
              label: "Download",
              onClick: () => startDownload(event.version),
            },
          });
          break;
        case "progress":
          toast.loading("Downloading update…", {
            id: UPDATE_TOAST_ID,
            description: `${Math.round(event.percent)}%`,
            duration: Infinity,
          });
          break;
        case "downloaded":
          toast.success("Update ready", {
            id: UPDATE_TOAST_ID,
            description: `Restart to install version ${event.version}.`,
            duration: Infinity,
            action: {
              label: "Restart now",
              onClick: () => window.updater.install(),
            },
          });
          break;
        case "error":
          toast.error("Update failed", {
            id: UPDATE_TOAST_ID,
            description: event.message,
          });
          break;
        default:
          break;
      }
    });
  }, []);
}
