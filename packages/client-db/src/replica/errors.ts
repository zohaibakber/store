import * as Schema from "effect/Schema";

export class UnsupportedSubsetQuery extends Schema.TaggedError<UnsupportedSubsetQuery>()(
  "UnsupportedSubsetQuery",
  {
    message: Schema.String,
    reason: Schema.String,
  },
) {}

export class ReplicaRowInvalid extends Schema.TaggedError<ReplicaRowInvalid>()(
  "ReplicaRowInvalid",
  {
    message: Schema.String,
    source: Schema.String,
  },
) {}

export class ReplicaSnapshotFailure extends Schema.TaggedError<ReplicaSnapshotFailure>()(
  "ReplicaSnapshotFailure",
  {
    message: Schema.String,
  },
) {}
