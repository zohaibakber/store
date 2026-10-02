import { isConnectivityFailure } from "@store/contracts";

import { toastManager } from "@/components/ui/toast";

const remoteFailurePrefix = /^Error invoking remote method '[^']+': (?:[\w$.@/-]+: )?/;

export const remoteFailureMessage = (message: string) => message.replace(remoteFailurePrefix, "");

export const storeErrorMessage = (
  cause: unknown,
  fallback = "Something went wrong. Try again.",
): string => {
  if (!(cause instanceof Error)) return fallback;
  const message = remoteFailureMessage(cause.message).trim();
  if (!message || isConnectivityFailure(message) || message.startsWith("net::")) {
    return fallback;
  }
  return message;
};

export const toastStoreError = (cause: unknown, fallback?: string) => {
  const raw = cause instanceof Error ? remoteFailureMessage(cause.message) : "";
  if (isConnectivityFailure(raw) || raw.startsWith("net::")) return;
  toastManager.add({ title: storeErrorMessage(cause, fallback), type: "error" });
};
