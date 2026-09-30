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

export class CatalogBusy extends Schema.TaggedError<CatalogBusy>()("CatalogBusy", {
  message: Schema.String,
}) {}

export class WorkspaceReadFailure extends Schema.TaggedError<WorkspaceReadFailure>()(
  "WorkspaceReadFailure",
  {
    message: Schema.String,
  },
) {}

export const staleCatalogLease = () =>
  new StaleCatalogLease({ message: "Catalog lease is no longer current." });

export const catalogBusy = () =>
  new CatalogBusy({ message: "The previous workspace is still closing. Try again shortly." });

export const catalogOpenFailure = (cause: unknown) =>
  new CatalogOpenFailure({
    message:
      cause instanceof Error && cause.message ? cause.message : "Catalog storage is unavailable.",
  });
