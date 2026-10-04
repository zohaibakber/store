import { SyncProtocolCode, SyncProtocolError } from "@store/contracts";
import { ReplicaStorageError } from "@store/contracts/replica";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export { ReplicaStorageError };

export class ReplicaCoverageRepairRequired extends Schema.TaggedError<ReplicaCoverageRepairRequired>()(
  "ReplicaCoverageRepairRequired",
  {
    subscription: Schema.String,
  },
) {}

export class SyncRecoveryRequired extends Schema.TaggedError<SyncRecoveryRequired>()(
  "SyncRecoveryRequired",
  {
    code: SyncProtocolCode,
    message: Schema.String,
  },
) {}

export type ReplicaStoreError = SyncProtocolError | ReplicaStorageError;

const STORAGE_FULL_PATTERN = /database or disk is full|SQLITE_FULL/iu;

const SQLITE_FULL_CODE = 13;

const CauseLink = Schema.Struct({
  _tag: Schema.optionalKey(Schema.String),
  errcode: Schema.optionalKey(Schema.Number),
  message: Schema.optionalKey(Schema.String),
  reasons: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  cause: Schema.optionalKey(Schema.Unknown),
  reason: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Unknown),
  defect: Schema.optionalKey(Schema.Unknown),
});
type CauseLink = typeof CauseLink.Type;

const decodeCauseLink = Schema.decodeUnknownOption(CauseLink);

const MAX_CAUSE_DEPTH = 10;

const someInCauseChain = (
  cause: unknown,
  matches: (link: CauseLink) => boolean,
  depth = 0,
): boolean =>
  depth <= MAX_CAUSE_DEPTH &&
  Option.match(decodeCauseLink(cause), {
    onNone: () => false,
    onSome: (link) =>
      matches(link) ||
      (link.reasons ?? [link.cause, link.reason, link.error, link.defect]).some((next) =>
        someInCauseChain(next, matches, depth + 1),
      ),
  });

const isStorageFull = (cause: unknown): boolean =>
  someInCauseChain(
    cause,
    (link) =>
      (link.errcode !== undefined && (link.errcode & 0xff) === SQLITE_FULL_CODE) ||
      (link.message !== undefined && STORAGE_FULL_PATTERN.test(link.message)),
  );

export const hasSqlReason = (cause: unknown, tags: ReadonlyArray<string>): boolean =>
  someInCauseChain(cause, (link) => link._tag !== undefined && tags.includes(link._tag));

export const isStorageFullFailure = (cause: unknown): boolean =>
  cause instanceof ReplicaStorageError && cause.full === true;

export const mapReplicaStoreFailure = (cause: unknown): ReplicaStoreError => {
  if (cause instanceof SyncProtocolError || cause instanceof ReplicaStorageError) return cause;
  if (isStorageFull(cause)) {
    return ReplicaStorageError.make({ message: "Replica storage is full.", full: true });
  }
  return ReplicaStorageError.make({
    message: cause instanceof Error ? cause.message : "Replica storage failed.",
  });
};
