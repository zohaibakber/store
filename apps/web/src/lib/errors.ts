import { toastManager } from "@/components/ui/toast";

// Electron wraps main-process failures before they reach the renderer.
const ipcPrefix = /^Error invoking remote method '[^']+': (?:Error: )?/;

export const storeErrorMessage = (
  cause: unknown,
  fallback = "Something went wrong. Try again.",
): string => {
  return cause instanceof Error ? cause.message.replace(ipcPrefix, "") : fallback;
};

export const toastStoreError = (cause: unknown, fallback?: string) => {
  toastManager.add({ title: storeErrorMessage(cause, fallback), type: "error" });
};
