import type { CatalogRefusalReason } from "@store/contracts/catalog-refusal";
import type {
  CommandFailure,
  ReadFailure,
  ReplicaUnavailableReason,
} from "@store/contracts/replica";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import * as Schema from "effect/Schema";

export class StaleCatalogLease extends Schema.TaggedError<StaleCatalogLease>()(
  "StaleCatalogLease",
  {
    message: Schema.String,
  },
) {}

export class CatalogOpenFailure extends Schema.TaggedError<CatalogOpenFailure>()(
  "CatalogOpenFailure",
  {
    message: Schema.String,
  },
) {}

export const staleCatalogLease = () =>
  new StaleCatalogLease({ message: "Catalog lease is no longer current." });

export const catalogOpenFailure = (cause: unknown) =>
  new CatalogOpenFailure({
    message:
      cause instanceof Error && cause.message ? cause.message : "Catalog storage is unavailable.",
  });

export type InventoryFailure = CommandFailure | ReadFailure | RpcClientError;

export type FailureSurface =
  | {
      readonly _tag: "refusal";
      readonly reason: CatalogRefusalReason;
      readonly message: string;
      readonly field: string | undefined;
    }
  | { readonly _tag: "storageFull"; readonly message: string }
  | { readonly _tag: "storage"; readonly message: string }
  | {
      readonly _tag: "unavailable";
      readonly reason: ReplicaUnavailableReason;
      readonly message: string;
    }
  | { readonly _tag: "sync"; readonly message: string }
  | { readonly _tag: "defect"; readonly message: string };

export const STORAGE_FAILED = "Local replica storage failed.";

export const STORAGE_FULL =
  "This device is out of storage space. Free up space, then try again. Nothing was saved.";

export const UNEXPECTED_FAILURE = "Something went wrong. Try again.";

export const replicaUnavailableCopy = (reason: ReplicaUnavailableReason): string => {
  switch (reason) {
    case "opening":
      return "The catalog is still opening. Try again in a moment.";
    case "corrupt":
      return "The catalog on this device is damaged. Restore a backup to continue.";
    case "tooNew":
      return "This catalog was saved by a newer version of the app. Update the app to open it.";
    case "busy":
      return "The catalog is busy. Try again in a moment.";
    case "closed":
      return "The catalog is closed. Reopen the workspace to continue.";
    case "restarting":
      return "The catalog is restarting. Check that your last change was saved before trying again.";
    case "exhausted":
      return "The local database stopped and could not restart. Pending changes are saved on this device. Try again, or restart the app.";
  }
};

export const failureSurface = (failure: InventoryFailure): FailureSurface => {
  switch (failure._tag) {
    case "CatalogRefusal":
      return {
        _tag: "refusal",
        reason: failure.reason,
        message: failure.message,
        field: failure.field,
      };
    case "ReplicaStorageError":
      return failure.full === true
        ? { _tag: "storageFull", message: STORAGE_FULL }
        : { _tag: "storage", message: failure.message || STORAGE_FAILED };
    case "ReplicaUnavailable":
      return {
        _tag: "unavailable",
        reason: failure.reason,
        message: replicaUnavailableCopy(failure.reason),
      };
    case "SyncProtocolError":
      return { _tag: "sync", message: failure.message };
    case "RpcClientError":
      return { _tag: "defect", message: UNEXPECTED_FAILURE };
  }
};

export const causeSurface = (cause: Cause.Cause<InventoryFailure>): FailureSurface =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: (): FailureSurface => ({ _tag: "defect", message: UNEXPECTED_FAILURE }),
    onSome: failureSurface,
  });

export class InventoryCommandError extends Error {
  readonly surface: FailureSurface;
  constructor(surface: FailureSurface) {
    super(surface.message);
    this.name = "InventoryCommandError";
    this.surface = surface;
  }
}

export const commandFailureSurface = (cause: unknown): FailureSurface | undefined =>
  cause instanceof InventoryCommandError ? cause.surface : undefined;
