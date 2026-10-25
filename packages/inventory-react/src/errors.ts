import type { LicenceRefusal, LicenceRefusalReason, StaffRefusalReason } from "@store/contracts";
import type { CatalogRefusalReason } from "@store/contracts/catalog-refusal";
import type {
  CommandFailure,
  ReadFailure,
  ReplicaUnavailableReason,
  StaffFailure,
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

const CATALOG_STORAGE_UNAVAILABLE = "Catalog storage is unavailable.";

export class CatalogOpenFailure extends Schema.TaggedError<CatalogOpenFailure>()(
  "CatalogOpenFailure",
  {
    reason: Schema.Literals([
      "engineUnavailable",
      "portsTimeout",
      "firstReadTimeout",
      "firstReadFailed",
      "openRefused",
    ]),
    detail: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "engineUnavailable":
        return "Native Electron replica SQLite is unavailable.";
      case "portsTimeout":
        return "The local database did not answer. Try again.";
      case "openRefused":
        return this.detail ?? CATALOG_STORAGE_UNAVAILABLE;
      case "firstReadTimeout":
      case "firstReadFailed":
        return CATALOG_STORAGE_UNAVAILABLE;
    }
  }
}

export class RestockExportStale extends Schema.TaggedError<RestockExportStale>()(
  "RestockExportStale",
  {},
) {}

export const staleCatalogLease = () =>
  new StaleCatalogLease({ message: "Catalog lease is no longer current." });

export const catalogOpenRefused = (cause: unknown) =>
  new CatalogOpenFailure(
    cause instanceof Error && cause.message !== ""
      ? { reason: "openRefused", detail: cause.message }
      : { reason: "openRefused" },
  );

export type InventoryFailure =
  | CommandFailure
  | ReadFailure
  | StaffFailure
  | LicenceRefusal
  | RpcClientError;

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
  | {
      readonly _tag: "staff";
      readonly reason: StaffRefusalReason;
      readonly retryAfterMillis: number | undefined;
      readonly message: string;
    }
  | {
      readonly _tag: "licence";
      readonly reason: LicenceRefusalReason;
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

const waitCopy = (retryAfterMillis: number | undefined): string => {
  if (retryAfterMillis === undefined) return "Wait a moment, then try again.";
  const seconds = Math.ceil(retryAfterMillis / 1_000);
  return seconds < 90
    ? `Try again in ${seconds} seconds.`
    : `Try again in ${Math.ceil(seconds / 60)} minutes.`;
};

export const staffRefusalCopy = (reason: StaffRefusalReason, retryAfterMillis?: number): string => {
  switch (reason) {
    case "disabled":
      return "Staff access is not available on this device.";
    case "locked":
      return "The app is locked. Enter your PIN to continue.";
    case "forbidden":
      return "Your role does not allow this. Ask the owner or a manager.";
    case "wrongPin":
      return "That PIN is not correct.";
    case "wrongRecoveryCode":
      return "That recovery code is not correct.";
    case "throttled":
      return `Too many wrong attempts. ${waitCopy(retryAfterMillis)}`;
    case "alreadySetUp":
      return "An owner is already set up on this device.";
    case "unknownStaff":
      return "That staff member no longer exists.";
    case "nameTaken":
      return "Another staff member already has that name.";
    case "ownerIsFixed":
      return "The owner cannot be removed or given another role.";
    case "tooManyStaff":
      return "This shop has reached the staff limit. Remove someone first.";
  }
};

export const licenceRefusalCopy = (reason: LicenceRefusalReason): string => {
  switch (reason) {
    case "missing":
      return "This computer has no licence yet. Enter your licence to continue.";
    case "expired":
      return "The licence has expired. Renew it to record sales and changes again.";
    case "malformed":
      return "That is not a complete licence. Paste all of it, or open the licence file.";
    case "badSignature":
      return "That licence is not genuine or was changed. Ask for it again.";
    case "unknownKey":
      return "This version of the app cannot read that licence. Update the app and try again.";
    case "otherShop":
      return "That licence belongs to a different shop than the data on this computer.";
    case "notNewer":
      return "That licence does not run longer than the one already here.";
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
    case "StaffRefusal":
      return {
        _tag: "staff",
        reason: failure.reason,
        retryAfterMillis: failure.retryAfterMillis,
        message: staffRefusalCopy(failure.reason, failure.retryAfterMillis),
      };
    case "LicenceRefusal":
      return {
        _tag: "licence",
        reason: failure.reason,
        message: licenceRefusalCopy(failure.reason),
      };
    case "SyncProtocolError":
      return { _tag: "sync", message: failure.message };
    case "RpcClientError":
      return { _tag: "defect", message: UNEXPECTED_FAILURE };
  }
};

export const RESTOCK_EXPORT_STALE_COPY = "The insights were recalculated. Try again in a moment.";

export const restockExportFailureCopy = (
  cause: Cause.Cause<InventoryFailure | RestockExportStale>,
): string =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => UNEXPECTED_FAILURE,
    onSome: (failure) =>
      failure._tag === "RestockExportStale"
        ? RESTOCK_EXPORT_STALE_COPY
        : failureSurface(failure).message,
  });

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
