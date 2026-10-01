import { analyticsDatabasePath } from "@store/client-db/node-analytics";
import { readPublishSummary } from "@store/client-db/node-publish";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import {
  localCatalogReport,
  standingFromRowCount,
  UNKNOWN_CATALOG,
  type LocalCatalogReport,
} from "../src/lib/local-catalog-standing";
import type { CatalogCounts } from "../src/lib/workspace-backup";
import type { PublishOffer, PublishOutcome, PublishProgress } from "../src/lib/workspace-publish";
import {
  archiveReplicaFile,
  readPublishMarker,
  removePublishMarker,
  replicaFileExists,
  writePublishMarker,
  type PublishMarker,
} from "./replica-publish-files";
import { removeReplicaFile } from "./replica-restore-files";
import type { ReplicaPublishSummary, ReplicaWorkerFailure } from "./replica-rpc";

type Summary = typeof ReplicaPublishSummary.Type;

type StageEvent =
  | { readonly _tag: "staged"; readonly rowCount: number }
  | {
      readonly _tag: "sealed";
      readonly partCount: number;
      readonly digest: string;
      readonly digestVersion: number;
    };

type PublishCommitResult =
  | { readonly _tag: "committed" }
  | { readonly _tag: "refused"; readonly code: string; readonly message: string }
  | { readonly _tag: "unconfirmed"; readonly message: string };

type PublishClient = {
  readonly PublishSummary: (input: {
    readonly sourcePath: string;
  }) => Effect.Effect<Summary, { readonly message: string }>;
  readonly PublishCommit: (input: {
    readonly sourcePath: string;
    readonly importId: Summary["importId"];
    readonly seal: PublishMarker["seal"];
    readonly acceptChangedFile: boolean;
  }) => Effect.Effect<PublishCommitResult, { readonly message: string }>;
  readonly PublishStage: (input: {
    readonly sourcePath: string;
    readonly importId: Summary["importId"];
  }) => Stream.Stream<StageEvent, { readonly message: string }>;
};

export type PublishPorts = {
  readonly organizationId: string;
  readonly databasePath: string;
  readonly worker: <A, E extends { readonly message: string }>(
    use: (client: PublishClient) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, ReplicaWorkerFailure>;
  readonly progress: (progress: PublishProgress) => Effect.Effect<void>;
};

type Standing =
  | { readonly _tag: "absent" }
  | { readonly _tag: "elsewhere"; readonly organizationId: string; readonly summary: Summary }
  | {
      readonly _tag: "here";
      readonly summary: Summary;
      readonly pending: Option.Option<PublishMarker>;
    };

const NO_OFFER: PublishOffer = { _tag: "none" };

const NOTHING_TO_MOVE = "This device has no data to move.";

const IMPORT_CONFLICT = "ENTITY_CONFLICT";

const FILE_CHANGED = "changed";

const MOVING_ELSEWHERE =
  "This device's data is already being moved to another organization. Open that organization to finish, or cancel that move.";

const UNFINISHED = "This device's data could not be read to the end. Try again.";

const failed = (message: string): PublishOutcome => ({ _tag: "failed", message });

const countsOf = (summary: Summary): CatalogCounts => ({
  products: summary.products,
  sales: summary.sales,
});

const readStanding = Effect.fn("ReplicaPublish.readStanding")(function* (ports: PublishPorts) {
  if (!(yield* replicaFileExists(ports.databasePath))) {
    yield* removePublishMarker(ports.databasePath);
    return { _tag: "absent" } satisfies Standing;
  }
  const summary = yield* ports.worker((client) =>
    client.PublishSummary({ sourcePath: ports.databasePath }),
  );
  const marker = yield* readPublishMarker(ports.databasePath);
  if (Option.isNone(marker)) return { _tag: "here", summary, pending: marker } satisfies Standing;
  if (marker.value.organizationId !== ports.organizationId) {
    return {
      _tag: "elsewhere",
      organizationId: marker.value.organizationId,
      summary,
    } satisfies Standing;
  }
  // The sealed import id stays put after later local commits. Dropping it
  // would stage a new import into an organization that already accepted it.
  return { _tag: "here", summary, pending: marker } satisfies Standing;
});

export const readLocalCatalogStanding = (databasePath: string): Effect.Effect<LocalCatalogReport> =>
  readPublishSummary(databasePath).pipe(
    Effect.map((summary) => localCatalogReport(standingFromRowCount(summary.rows))),
    Effect.catchTag("ReplicaPublishFailure", (failure) =>
      Effect.succeed(failure.reason === "empty" ? localCatalogReport("empty") : UNKNOWN_CATALOG),
    ),
  );

export const readPublishOffer = (ports: PublishPorts): Effect.Effect<PublishOffer> =>
  readStanding(ports).pipe(
    Effect.map((standing): PublishOffer => {
      switch (standing._tag) {
        case "absent":
          return NO_OFFER;
        case "elsewhere":
          return {
            _tag: "elsewhere",
            organizationId: standing.organizationId,
            counts: countsOf(standing.summary),
          };
        case "here":
          return standing.summary.rows === 0
            ? NO_OFFER
            : {
                _tag: "available",
                counts: countsOf(standing.summary),
                resuming: Option.isSome(standing.pending),
              };
      }
    }),
    Effect.catch(() => Effect.succeed(NO_OFFER)),
  );

export const discardPublish = (ports: PublishPorts): Effect.Effect<PublishOffer> =>
  removePublishMarker(ports.databasePath).pipe(Effect.andThen(readPublishOffer(ports)));

const commit = (
  ports: PublishPorts,
  marker: Pick<PublishMarker, "importId" | "seal">,
  acceptChangedFile = false,
) =>
  ports.worker((client) =>
    client.PublishCommit({
      sourcePath: ports.databasePath,
      importId: marker.importId,
      seal: marker.seal,
      acceptChangedFile,
    }),
  );

const setAside = Effect.fn("ReplicaPublish.setAside")(function* (
  ports: PublishPorts,
  counts: CatalogCounts,
) {
  yield* archiveReplicaFile({
    databasePath: ports.databasePath,
    now: yield* Clock.currentTimeMillis,
  });
  yield* removeReplicaFile(analyticsDatabasePath(ports.databasePath));
  yield* removePublishMarker(ports.databasePath);
  return { _tag: "published", counts } satisfies PublishOutcome;
});

const resume = Effect.fn("ReplicaPublish.resume")(function* (
  ports: PublishPorts,
  marker: PublishMarker,
  counts: CatalogCounts,
) {
  const first = yield* commit(ports, marker);
  // A later local commit changes the import id. Ask again with the stored
  // seal: the server returns the previous result when that id and digest
  // already landed, and commits the sealed parts only when it has not.
  const resumed =
    first._tag === "refused" && first.code === FILE_CHANGED
      ? yield* commit(ports, marker, true)
      : first;
  switch (resumed._tag) {
    case "committed":
      return Option.some(yield* setAside(ports, counts));
    case "unconfirmed":
      return Option.some(failed(resumed.message));
    case "refused":
      // The organization already holds inventory, or the stored seal still does
      // not match this file. Either way the sealed import stays on disk.
      return resumed.code === IMPORT_CONFLICT || resumed.code === FILE_CHANGED
        ? Option.some(failed(resumed.message))
        : Option.none<PublishOutcome>();
  }
});

const stage = Effect.fn("ReplicaPublish.stage")(function* (ports: PublishPorts, summary: Summary) {
  const sent = yield* Ref.make(0);
  const last = yield* ports.worker((client) =>
    client.PublishStage({ sourcePath: ports.databasePath, importId: summary.importId }).pipe(
      Stream.tap((event) => {
        switch (event._tag) {
          case "staged":
            return Ref.updateAndGet(sent, (rows) => rows + event.rowCount).pipe(
              Effect.flatMap((rows) => ports.progress({ sent: rows, total: summary.rows })),
            );
          case "sealed":
            return Effect.void;
        }
      }),
      Stream.runLast,
    ),
  );
  return Option.flatMap(last, (event) => {
    switch (event._tag) {
      case "staged":
        return Option.none();
      case "sealed":
        return Option.some({
          partCount: event.partCount,
          digest: event.digest,
          digestVersion: event.digestVersion,
        });
    }
  });
});

const publishFrom = Effect.fn("ReplicaPublish.publishFrom")(function* (
  ports: PublishPorts,
  summary: Summary,
  pending: Option.Option<PublishMarker>,
) {
  const counts = countsOf(summary);
  if (Option.isSome(pending)) {
    const resumed = yield* resume(ports, pending.value, counts);
    if (Option.isSome(resumed)) return resumed.value;
  }
  yield* removePublishMarker(ports.databasePath);
  const seal = yield* stage(ports, summary);
  if (Option.isNone(seal)) return failed(UNFINISHED);
  const written: PublishMarker = {
    organizationId: ports.organizationId,
    importId: summary.importId,
    seal: seal.value,
    startedAt: yield* Clock.currentTimeMillis,
  };
  yield* writePublishMarker(ports.databasePath, written);
  const committed = yield* commit(ports, written);
  switch (committed._tag) {
    case "committed":
      return yield* setAside(ports, counts);
    case "refused":
      yield* removePublishMarker(ports.databasePath);
      return failed(committed.message);
    case "unconfirmed":
      return failed(committed.message);
  }
});

export const publishLocalWorkspace = (ports: PublishPorts): Effect.Effect<PublishOutcome> =>
  readStanding(ports).pipe(
    Effect.flatMap((standing) => {
      switch (standing._tag) {
        case "absent":
          return Effect.succeed(failed(NOTHING_TO_MOVE));
        case "elsewhere":
          return Effect.succeed(failed(MOVING_ELSEWHERE));
        case "here":
          return publishFrom(ports, standing.summary, standing.pending);
      }
    }),
    Effect.catch((cause) => Effect.succeed(failed(cause.message))),
  );
