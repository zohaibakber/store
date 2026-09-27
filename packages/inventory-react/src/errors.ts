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
