import { existsSync } from "node:fs";

import {
  ImportCatalogRequest,
  ImportId,
  MAX_IMPORT_PART_BYTES,
  MAX_IMPORT_PARTS,
  type SyncEntity,
} from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import { sha256Hex } from "@store/contracts/operation-hash";
import {
  commandOutbox,
  invoices,
  products,
  purchaseOrders,
  replicaState,
} from "@store/db/replica.schema";
import {
  SqliteReplica,
  sqliteCatalogParts,
  sqlitePartitionDigest,
  type CatalogPart,
  type SqliteReplicaHandle,
} from "@store/sync/sql-client";
import { layerNodeSqliteReplica } from "@store/sync/sqlite";
import { count, eq, inArray } from "drizzle-orm";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Number from "effect/Number";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Struct from "effect/Struct";

import type { ImportClient, ImportFailure } from "./proxy-import";

class ReplicaPublishFailure extends Schema.TaggedError<ReplicaPublishFailure>()(
  "ReplicaPublishFailure",
  {
    reason: Schema.Literals([
      "saving",
      "changed",
      "empty",
      "tooLarge",
      "storage",
      "refused",
      "unavailable",
    ]),
    message: Schema.String,
  },
) {}

export type ReplicaPublishSummary = {
  readonly importId: ImportId;
  readonly products: number;
  readonly sales: number;
  readonly purchaseOrders: number;
  readonly rows: number;
  readonly outstanding: number;
};

export type ReplicaPublishSeal = {
  readonly partCount: number;
  readonly digest: string;
  readonly digestVersion: number;
};

type Sealed = { readonly _tag: "sealed" } & ReplicaPublishSeal;

export type ReplicaPublishProgress =
  | { readonly _tag: "staged"; readonly partNumber: number; readonly rowCount: number }
  | Sealed;

type ReplicaPublishChunk =
  | {
      readonly _tag: "part";
      readonly partNumber: number;
      readonly rowCount: number;
      readonly bodyText: string;
    }
  | Sealed;

export type ReplicaPublishCommit =
  | { readonly _tag: "committed" }
  | { readonly _tag: "refused"; readonly code: string; readonly message: string }
  | { readonly _tag: "unconfirmed"; readonly message: string };

const OUTSTANDING_STATUSES = ["pending", "sending", "accepted_awaiting_integration"] as const;

const PUBLISHED_ENTITIES: ReadonlyArray<SyncEntity> = Struct.keys(syncEntityRows);

const singleton = eq(replicaState.id, "singleton");

const isUnreadableRecord = Predicate.isTagged("ReplicaStorageError");

const storage = (cause: unknown) =>
  new ReplicaPublishFailure({
    reason: "storage",
    message:
      isUnreadableRecord(cause) && cause instanceof Error
        ? cause.message
        : "This device's data could not be read.",
  });

const saving = (outstanding: number | undefined) =>
  new ReplicaPublishFailure({
    reason: "saving",
    message:
      outstanding === undefined
        ? "This device is still saving changes. Try again in a moment."
        : `This device is still saving ${outstanding} ${outstanding === 1 ? "change" : "changes"}. Try again in a moment.`,
  });

const changed = () =>
  new ReplicaPublishFailure({
    reason: "changed",
    message: "This device's data changed while it was being read. Try again.",
  });

const nothingToMove = () =>
  new ReplicaPublishFailure({ reason: "empty", message: "This device has no data to move." });

const tooLarge = (message: string) => new ReplicaPublishFailure({ reason: "tooLarge", message });

const asPublishFailure = (cause: unknown) =>
  cause instanceof ReplicaPublishFailure ? cause : storage(cause);

const failureOf = (cause: Cause.Cause<unknown>) =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => storage(Cause.squash(cause)),
    onSome: asPublishFailure,
  });

type CountedTable = (typeof syncEntityRows)[SyncEntity]["table"];

const countRows = (handle: SqliteReplicaHandle, table: CountedTable) =>
  handle.db
    .select({ rows: count() })
    .from(table)
    .get()
    .pipe(Effect.map((counted) => counted?.rows ?? 0));

const summarize = Effect.fn("ReplicaPublish.summarize")(function* (handle: SqliteReplicaHandle) {
  const state = yield* handle.db
    .select({
      organizationId: replicaState.organizationId,
      replicaId: replicaState.replicaId,
      registeredAt: replicaState.registeredAt,
      generation: replicaState.activeGeneration,
      localCommitVersion: replicaState.localCommitVersion,
    })
    .from(replicaState)
    .where(singleton)
    .get();
  if (state === undefined) return yield* nothingToMove();
  const outbox = yield* handle.db
    .select({ rows: count() })
    .from(commandOutbox)
    .where(inArray(commandOutbox.status, OUTSTANDING_STATUSES))
    .get();
  const rows = yield* Effect.forEach(PUBLISHED_ENTITIES, (entity) =>
    countRows(handle, syncEntityRows[entity].table),
  );
  return {
    organizationId: state.organizationId,
    importId: ImportId.make(
      yield* sha256Hex(
        `${state.replicaId}:${state.registeredAt ?? 0}:${state.generation}:${state.localCommitVersion}`,
      ),
    ),
    products: yield* countRows(handle, products),
    sales: yield* countRows(handle, invoices),
    purchaseOrders: yield* countRows(handle, purchaseOrders),
    rows: Number.sumAll(rows),
    outstanding: outbox?.rows ?? 0,
  };
});

const replicaAt = (path: string) => (existsSync(path) ? layerNodeSqliteReplica(path) : undefined);

const withReplica = <A, E>(
  path: string,
  use: (handle: SqliteReplicaHandle) => Effect.Effect<A, E>,
): Effect.Effect<A, ReplicaPublishFailure> =>
  Effect.suspend(() => {
    const replica = replicaAt(path);
    if (replica === undefined) return Effect.fail(nothingToMove());
    return SqliteReplica.use(use).pipe(
      Effect.provide(replica),
      Effect.catchCause((cause) => Effect.fail(failureOf(cause))),
    );
  });

export const readPublishSummary = (
  path: string,
): Effect.Effect<ReplicaPublishSummary, ReplicaPublishFailure> =>
  withReplica(path, summarize).pipe(
    Effect.map((summary) => Struct.omit(summary, ["organizationId"])),
  );

const admitPart = (part: CatalogPart) => {
  if (part.partNumber > MAX_IMPORT_PARTS) {
    return Effect.fail(tooLarge("This device holds more data than can be moved in one go."));
  }
  if (Buffer.byteLength(part.bodyText, "utf8") > MAX_IMPORT_PART_BYTES) {
    return Effect.fail(tooLarge("One record on this device is too large to move."));
  }
  return Effect.succeed<ReplicaPublishChunk>({ _tag: "part", ...part });
};

const seal = Effect.fn("ReplicaPublish.seal")(function* (
  handle: SqliteReplicaHandle,
  importId: string,
  partCount: number,
) {
  if (partCount === 0) return yield* nothingToMove();
  const closing = yield* summarize(handle);
  if (closing.importId !== importId) return yield* changed();
  const digest = yield* sqlitePartitionDigest(handle.db);
  if (digest === undefined) return yield* saving(undefined);
  return {
    _tag: "sealed",
    partCount,
    digest: digest.digest,
    digestVersion: digest.version,
  } satisfies ReplicaPublishChunk;
});

const verifySealed = Effect.fn("ReplicaPublish.verifySealed")(function* (
  handle: SqliteReplicaHandle,
  importId: string,
  sealed: ReplicaPublishSeal,
) {
  const current = yield* summarize(handle);
  const digest = yield* sqlitePartitionDigest(handle.db);
  if (current.importId !== importId || digest?.digest !== sealed.digest) return yield* changed();
});

const publishParts = (
  path: string,
  importId: string,
): Stream.Stream<ReplicaPublishChunk, ReplicaPublishFailure> =>
  Stream.suspend(() => {
    const replica = replicaAt(path);
    if (replica === undefined) return Stream.fail(nothingToMove());
    return Stream.unwrap(
      Effect.gen(function* () {
        const handle = yield* SqliteReplica;
        const opening = yield* summarize(handle);
        if (opening.importId !== importId) return yield* changed();
        if (opening.outstanding > 0) return yield* saving(opening.outstanding);
        const partCount = yield* Ref.make(0);
        return sqliteCatalogParts(handle.db, {
          partId: importId,
          organizationId: opening.organizationId,
        }).pipe(
          Stream.mapEffect((part) =>
            Effect.tap(admitPart(part), () => Ref.set(partCount, part.partNumber)),
          ),
          Stream.concat(
            Stream.fromEffect(
              Effect.flatMap(Ref.get(partCount), (count) => seal(handle, importId, count)),
            ),
          ),
        );
      }),
    ).pipe(
      Stream.provide(replica),
      Stream.catchCause((cause) => Stream.fail(failureOf(cause))),
    );
  });

const STAGING_CONCURRENCY = 2;

const asStagingFailure = (failure: ImportFailure): ReplicaPublishFailure => {
  switch (failure._tag) {
    case "ImportRefused":
      return new ReplicaPublishFailure({ reason: "refused", message: failure.message });
    case "ImportUnavailable":
      return new ReplicaPublishFailure({ reason: "unavailable", message: failure.message });
  }
};

const garbled = () =>
  new ReplicaPublishFailure({
    reason: "unavailable",
    message: "The server received something other than what this device sent. Try again.",
  });

const stage = (
  client: ImportClient,
  importId: string,
  chunk: ReplicaPublishChunk,
): Effect.Effect<ReplicaPublishProgress, ReplicaPublishFailure> => {
  switch (chunk._tag) {
    case "sealed":
      return Effect.succeed(chunk);
    case "part":
      return Effect.gen(function* () {
        const receipt = yield* client
          .stagePart(importId, chunk.partNumber, chunk.bodyText)
          .pipe(Effect.mapError(asStagingFailure));
        if (receipt.sha256 !== (yield* sha256Hex(chunk.bodyText))) return yield* garbled();
        return { _tag: "staged", partNumber: chunk.partNumber, rowCount: chunk.rowCount };
      });
  }
};

export const stagePublish = (input: {
  readonly path: string;
  readonly importId: string;
  readonly client: ImportClient;
}): Stream.Stream<ReplicaPublishProgress, ReplicaPublishFailure> =>
  publishParts(input.path, input.importId).pipe(
    Stream.mapEffect((chunk) => stage(input.client, input.importId, chunk), {
      concurrency: STAGING_CONCURRENCY,
    }),
  );

const decodeImportRequest = Schema.decodeUnknownEffect(ImportCatalogRequest);

const refused = (failure: {
  readonly code: string;
  readonly message: string;
}): ReplicaPublishCommit => ({
  _tag: "refused",
  code: failure.code,
  message: failure.message,
});

export const commitPublish = (input: {
  readonly path: string;
  readonly organizationId: string;
  readonly importId: string;
  readonly seal: ReplicaPublishSeal;
  readonly client: ImportClient;
  readonly acceptChangedFile?: boolean;
}): Effect.Effect<ReplicaPublishCommit> => {
  const sealed = input.acceptChangedFile
    ? Effect.void
    : withReplica(input.path, (handle) => verifySealed(handle, input.importId, input.seal));
  return sealed.pipe(
    Effect.andThen(decodeImportRequest({ organizationId: input.organizationId, ...input.seal })),
    Effect.flatMap((request) => input.client.commit(input.importId, request)),
    Effect.as<ReplicaPublishCommit>({ _tag: "committed" }),
    Effect.catchTags({
      ReplicaPublishFailure: (failure) =>
        Effect.succeed(refused({ code: failure.reason, message: failure.message })),
      SchemaError: () =>
        Effect.succeed(refused({ code: "INVALID_OPERATION", message: "The move is malformed." })),
      ImportRefused: (failure) => Effect.succeed(refused(failure)),
      ImportUnavailable: (failure) =>
        Effect.succeed<ReplicaPublishCommit>({ _tag: "unconfirmed", message: failure.message }),
    }),
  );
};

export { ImportRefused, makeProxyImportClient } from "./proxy-import";
export type { ImportClient } from "./proxy-import";
