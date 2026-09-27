import { isConnectivityFailure } from "@store/contracts";

import { toastManager } from "@/components/ui/toast";

const electronRemoteMethodPrefix = /^Error invoking remote method '[^']+': (?:Error: )?/;

export const storeErrorMessage = (
  cause: unknown,
  fallback = "Something went wrong. Try again.",
): string => {
  if (!(cause instanceof Error)) return fallback;
  const message = cause.message.replace(electronRemoteMethodPrefix, "").trim();
  if (!message || isConnectivityFailure(message) || message.startsWith("net::")) {
    return fallback;
  }
  return message;
};

export const toastStoreError = (cause: unknown, fallback?: string) => {
  const raw = cause instanceof Error ? cause.message.replace(electronRemoteMethodPrefix, "") : "";
  if (isConnectivityFailure(raw) || raw.startsWith("net::")) return;
  toastManager.add({ title: storeErrorMessage(cause, fallback), type: "error" });
};
