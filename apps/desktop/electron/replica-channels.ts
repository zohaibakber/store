import * as Schema from "effect/Schema";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));

export const REPLICA_OPEN_CHANNEL = "replica:open";
export const REPLICA_CLOSE_CHANNEL = "replica:close";
export const REPLICA_STAMP_CHANNEL = "replica:stamp";
export const REPLICA_QUERY_CHANNEL = "replica:query";
export const REPLICA_WAKE_CHANNEL = "replica:wake";
export const REPLICA_CANCEL_CHANNEL = "replica:cancel";
export const REPLICA_COMMIT_CHANNEL = "replica:commit";

export const ReplicaWorkerBootInput = Schema.Struct({
  organizationId: NonEmptyString,
  userId: NonEmptyString,
  replicaId: NonEmptyString,
  requestId: NonEmptyString,
});
export type ReplicaWorkerBootInput = typeof ReplicaWorkerBootInput.Type;

export const ReplicaWorkspaceToken = Schema.Struct({
  workspaceToken: NonEmptyString,
  engine: Schema.Literals(["sqlite", "unavailable"]),
});
export type ReplicaWorkspaceToken = typeof ReplicaWorkspaceToken.Type;

export const ReplicaStampResult = Schema.Struct({
  workspaceToken: NonEmptyString,
  generationId: NonEmptyString,
  localCommitVersion: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
export type ReplicaStampResult = typeof ReplicaStampResult.Type;

export const ReplicaQueryParameter = Schema.Union([Schema.String, Schema.Number, Schema.Null]);
export type ReplicaQueryParameter = typeof ReplicaQueryParameter.Type;

export const ReplicaQueryInput = Schema.Struct({
  workspaceToken: NonEmptyString,
  sql: Schema.String.check(Schema.isMinLength(1)),
  parameters: Schema.Array(ReplicaQueryParameter),
  stamped: Schema.optionalKey(Schema.Boolean),
});
export type ReplicaQueryInput = typeof ReplicaQueryInput.Type;

export const ReplicaQueryResult = Schema.Struct({
  rows: Schema.Array(Schema.Record(Schema.String, ReplicaQueryParameter)),
  stamp: Schema.optionalKey(
    Schema.Struct({
      generationId: NonEmptyString,
      localCommitVersion: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
});
export type ReplicaQueryResult = typeof ReplicaQueryResult.Type;

export const ReplicaWakeResult = Schema.Struct({
  workspaceToken: NonEmptyString,
  drained: Schema.Boolean,
  drainCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});
export type ReplicaWakeResult = typeof ReplicaWakeResult.Type;

export const ReplicaCommitEvent = Schema.Struct({
  workspaceToken: NonEmptyString,
  generationId: NonEmptyString,
  localCommitVersion: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  touchedEntities: Schema.Array(Schema.String),
  touchedKeys: Schema.Array(Schema.String),
});
export type ReplicaCommitEvent = typeof ReplicaCommitEvent.Type;

export type ReplicaIpcBridge = {
  readonly open: (input: ReplicaWorkerBootInput) => Promise<ReplicaWorkspaceToken>;
  readonly close: (workspaceToken: string) => Promise<void>;
  readonly stamp: (workspaceToken: string) => Promise<ReplicaStampResult>;
  readonly query: (input: ReplicaQueryInput) => Promise<ReplicaQueryResult>;
  readonly wakeSyncUpload: (workspaceToken: string) => Promise<ReplicaWakeResult>;
  readonly cancel: (requestId: string) => void;
  readonly onCommit: (callback: (event: ReplicaCommitEvent) => void) => () => void;
};

export type ReplicaWorkerRequest =
  | {
      readonly _tag: "boot";
      readonly requestId: string;
      readonly databasePath: string;
      readonly organizationId: string;
      readonly userId: string;
      readonly replicaId: string;
      readonly apiBaseUrl: string;
    }
  | { readonly _tag: "stamp"; readonly requestId: string }
  | {
      readonly _tag: "query";
      readonly requestId: string;
      readonly sql: string;
      readonly parameters: ReadonlyArray<string | number | null>;
      readonly stamped: boolean;
    }
  | { readonly _tag: "wake"; readonly requestId: string }
  | { readonly _tag: "dispose"; readonly requestId: string }
  | {
      readonly _tag: "proxyFetchResult";
      readonly requestId: string;
      readonly ok: boolean;
      readonly status: number;
      readonly bodyText: string;
    };

export type ReplicaWorkerResponse =
  | {
      readonly _tag: "ready";
      readonly requestId: string;
      readonly engine: "sqlite" | "unavailable";
    }
  | {
      readonly _tag: "stamp";
      readonly requestId: string;
      readonly generationId: string;
      readonly localCommitVersion: number;
    }
  | {
      readonly _tag: "query";
      readonly requestId: string;
      readonly rows: ReadonlyArray<Record<string, string | number | null>>;
      readonly stamp?: {
        readonly generationId: string;
        readonly localCommitVersion: number;
      };
    }
  | {
      readonly _tag: "woke";
      readonly requestId: string;
      readonly drained: boolean;
      readonly drainCount: number;
    }
  | {
      readonly _tag: "proxyFetch";
      readonly requestId: string;
      readonly method: "GET" | "POST";
      readonly pathname: string;
      readonly bodyText: string | null;
    }
  | {
      readonly _tag: "commit";
      readonly generationId: string;
      readonly localCommitVersion: number;
      readonly touchedEntities: ReadonlyArray<string>;
      readonly touchedKeys: ReadonlyArray<string>;
    }
  | { readonly _tag: "disposed"; readonly requestId: string }
  | { readonly _tag: "error"; readonly requestId?: string; readonly message: string };
