import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Progress, ProgressValue } from "@/components/ui/progress";

const UPDATE_TOAST_ID = "app-update";

function DownloadProgress({ percent }: { percent: number }) {
  // `Progress` already renders its own ProgressTrack/ProgressIndicator after
  // its children, so only pass the value label here.
  return (
    <Progress value={percent} className="mt-1 min-w-48 flex-col items-stretch gap-1">
      <ProgressValue className="ml-0" />
    </Progress>
  );
}

const startDownload = (version: string) => {
  toast.loading(`Downloading version ${version}…`, {
    id: UPDATE_TOAST_ID,
    description: <DownloadProgress percent={0} />,
    duration: Infinity,
  });
  void window.updater.download().catch(() => {
    // Failures are reported through the updater `error` event.
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
          toast(`Update available`, {
            id: UPDATE_TOAST_ID,
            description: `Version ${event.version} is ready to download.`,
            duration: Infinity,
            action: {
              label: "Download",
              onClick: () => {
                downloadingRef.current = true;
                startDownload(event.version);
              },
            },
          });
          break;
        case "progress":
          downloadingRef.current = true;
          toast.loading("Downloading update…", {
            id: UPDATE_TOAST_ID,
            description: <DownloadProgress percent={event.percent} />,
            duration: Infinity,
          });
          break;
        case "downloaded":
          downloadingRef.current = false;
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
          downloadingRef.current = false;
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
