import { isConnectivityFailure } from "@store/contracts";
import { causeSurface, type InventoryFailure } from "@store/inventory-react";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";

import { toastManager } from "@/components/ui/toast";

export const storeErrorMessage = (
  cause: unknown,
  fallback = "Something went wrong. Try again.",
): string => {
  if (!(cause instanceof Error)) return fallback;
  const message = cause.message.trim();
  if (!message || isConnectivityFailure(message) || message.startsWith("net::")) {
    return fallback;
  }
  return message;
};

const Messaged = Schema.Struct({ message: Schema.String });

export const toastStoreError = (cause: unknown, fallback?: string) => {
  const raw = Schema.is(Messaged)(cause) ? cause.message : "";
  if (isConnectivityFailure(raw) || raw.startsWith("net::")) return;
  toastManager.add({ title: storeErrorMessage(cause, fallback), type: "error" });
};

export const failureMessage = (cause: Cause.Cause<InventoryFailure>): string =>
  causeSurface(cause).message;

export const toastFailure = (cause: Cause.Cause<InventoryFailure>) => {
  if (Cause.hasInterruptsOnly(cause)) return;
  toastManager.add({ title: failureMessage(cause), type: "error" });
};
