import { causeSurface, type InventoryFailure } from "@store/inventory-react";
import * as Cause from "effect/Cause";

import { toastManager } from "@/components/ui/toast";
import { isBridgeFailure } from "@/host";

const DEFAULT_FALLBACK = "Something went wrong. Try again.";

type BridgeSurface =
  | { readonly _tag: "message"; readonly message: string }
  | { readonly _tag: "quiet"; readonly message: string };

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
