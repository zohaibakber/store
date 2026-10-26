import { isConnectivityFailure } from "@store/contracts";
import { causeSurface, type InventoryFailure } from "@store/inventory-react";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";

import { toastManager } from "@/components/ui/toast";
import { isBridgeFailure } from "@/host";

const DEFAULT_FALLBACK = "Something went wrong. Try again.";

type BridgeSurface =
  | { readonly _tag: "message"; readonly message: string }
  | { readonly _tag: "quiet"; readonly message: string };

export const storeErrorMessage = (cause: unknown, fallback = DEFAULT_FALLBACK): string => {
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

export const bridgeSurface = (cause: unknown, fallback = DEFAULT_FALLBACK): BridgeSurface => {
  if (!isBridgeFailure(cause)) return { _tag: "message", message: fallback };
  switch (cause._tag) {
    case "BridgeInterrupted":
      return { _tag: "quiet", message: fallback };
    case "SignInFailed":
    case "ServerRequestFailed":
      return cause.unreachable
        ? { _tag: "quiet", message: fallback }
        : { _tag: "message", message: cause.message.trim() || fallback };
    case "WorkspaceOpenFailed":
      return { _tag: "message", message: cause.message.trim() || fallback };
    case "ExternalLinkRefused":
      return { _tag: "message", message: fallback };
  }
};

const SERVER_UNREACHABLE = "Could not reach Tabaaq. Check your connection and try again.";

export const signInMessage = (cause: unknown, fallback: string): string => {
  if (!isBridgeFailure(cause) || cause._tag !== "SignInFailed") return fallback;
  return cause.unreachable ? SERVER_UNREACHABLE : cause.message.trim() || fallback;
};

export const bridgeMessage = (cause: unknown, fallback?: string): string =>
  bridgeSurface(cause, fallback).message;

export const toastBridgeFailure = (cause: unknown, fallback?: string) => {
  const surface = bridgeSurface(cause, fallback);
  if (surface._tag === "quiet") return;
  toastManager.add({ title: surface.message, type: "error" });
};

export const failureMessage = (cause: Cause.Cause<InventoryFailure>): string =>
  causeSurface(cause).message;

export const toastFailure = (cause: Cause.Cause<InventoryFailure>) => {
  if (Cause.hasInterruptsOnly(cause)) return;
  toastManager.add({ title: failureMessage(cause), type: "error" });
};
