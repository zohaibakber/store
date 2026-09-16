import * as Schema from "effect/Schema";

export class ReplicaStorageError extends Schema.TaggedError<ReplicaStorageError>()(
  "ReplicaStorageError",
  {
    message: Schema.String,
  },
) {}

export class ReplicaIncarnationMismatch extends Schema.TaggedError<ReplicaIncarnationMismatch>()(
  "ReplicaIncarnationMismatch",
  {
    expected: Schema.String,
    received: Schema.String,
  },
) {}

export class ReplicaAuthorityHeadBehind extends Schema.TaggedError<ReplicaAuthorityHeadBehind>()(
  "ReplicaAuthorityHeadBehind",
  {
    localApplied: Schema.String,
    authorityHorizon: Schema.String,
  },
) {}

export class ReplicaIdentityConflict extends Schema.TaggedError<ReplicaIdentityConflict>()(
  "ReplicaIdentityConflict",
  {
    message: Schema.String,
  },
) {}

export class ReplicaCoverageRepairRequired extends Schema.TaggedError<ReplicaCoverageRepairRequired>()(
  "ReplicaCoverageRepairRequired",
  {
    subscription: Schema.String,
  },
) {}

export class SyncTransportUnavailable extends Schema.TaggedError<SyncTransportUnavailable>()(
  "SyncTransportUnavailable",
  {
    message: Schema.String,
  },
) {}

export class SyncTransportInvalid extends Schema.TaggedError<SyncTransportInvalid>()(
  "SyncTransportInvalid",
  {
    message: Schema.String,
  },
) {}
