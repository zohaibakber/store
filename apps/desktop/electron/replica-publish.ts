import { analyticsDatabasePath } from "@store/client-db/node-analytics";
import type { CatalogCounts } from "@store/web/host/workspace-backup";
import type {
  LocalCatalogReport,
  PublishOffer,
  PublishOutcome,
  PublishProgress,
} from "@store/web/host/workspace-publish";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import {
  archiveReplicaFile,
  readPublishMarker,
  removePublishMarker,
  replicaFileExists,
  writePublishMarker,
  type PublishMarker,
} from "./replica-publish-files";
import { removeReplicaFile } from "./replica-restore-files";
import {
  catalogCountsOf,
  type ReplicaPublishSummary,
  type ReplicaWorkerFailure,
} from "./replica-rpc";
import type { ReplicaWorkerClient } from "./replica-supervisor";

type PublishClient = Pick<
  ReplicaWorkerClient,
  "PublishSummary" | "PublishStage" | "PublishCommit" | "PublishStatus"
>;

export type PublishPorts = {
  readonly organizationId: string;
  readonly databasePath: string;
  readonly worker: <A, E extends { readonly message: string }>(
    use: (client: PublishClient) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, ReplicaWorkerFailure>;
  readonly progress: (progress: PublishProgress) => Effect.Effect<void>;
};

type Summary = typeof ReplicaPublishSummary.Type;

type Standing =
  | { readonly _tag: "absent" }
  | { readonly _tag: "elsewhere"; readonly organizationId: string; readonly summary: Summary }
  | {
      readonly _tag: "here";
      readonly summary: Summary;
      readonly pending: Option.Option<PublishMarker>;
    };

export const NO_OFFER: PublishOffer = { _tag: "none" };

const NOTHING_TO_MOVE = "This device has no data to move.";

const MOVED_BEFORE_CHANGES =
  "This device's data was already moved to this organization. Changes made on this device since then are not in the organization and stay under This device.";

const MOVING_ELSEWHERE =
  "This device's data is already being moved to another organization. Open that organization to finish, or cancel that move.";

const UNFINISHED = "This device's data could not be read to the end. Try again.";

export const failed = (message: string): PublishOutcome => ({ _tag: "failed", message });

const readStanding = Effect.fn("ReplicaPublish.readStanding")(function* (ports: PublishPorts) {
  if (!(yield* replicaFileExists(ports.databasePath))) {
    yield* removePublishMarker(ports.databasePath);
    return { _tag: "absent" } satisfies Standing;
  }
  const summary = yield* ports.worker((client) =>
    client.PublishSummary({ sourcePath: ports.databasePath }),
  );
  const marker = yield* readPublishMarker(ports.databasePath);
  return Option.isSome(marker) && marker.value.organizationId !== ports.organizationId
    ? ({
        _tag: "elsewhere",
        organizationId: marker.value.organizationId,
        summary,
      } satisfies Standing)
    : ({ _tag: "here", summary, pending: marker } satisfies Standing);
});

export const readLocalCatalog = (
  ports: Pick<PublishPorts, "databasePath" | "worker">,
): Effect.Effect<LocalCatalogReport> =>
  replicaFileExists(ports.databasePath).pipe(
    Effect.flatMap((exists) =>
      exists
        ? ports
            .worker((client) => client.PublishSummary({ sourcePath: ports.databasePath }))
            .pipe(Effect.map((summary) => summary.rows))
        : Effect.succeed(0),
    ),
    Effect.map((rows): LocalCatalogReport => ({ _tag: rows > 0 ? "stocked" : "empty" })),
    Effect.catch(() => Effect.succeed<LocalCatalogReport>({ _tag: "unknown" })),
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
            counts: catalogCountsOf(standing.summary),
          };
        case "here":
          return standing.summary.rows === 0
            ? NO_OFFER
            : {
                _tag: "available",
                counts: catalogCountsOf(standing.summary),
                resuming: Option.isSome(standing.pending),
              };
      }
    }),
    Effect.catch(() => Effect.succeed(NO_OFFER)),
  );

export const discardPublish = (ports: PublishPorts): Effect.Effect<PublishOffer> =>
  removePublishMarker(ports.databasePath).pipe(Effect.andThen(readPublishOffer(ports)));

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
  summary: Summary,
) {
  const status = yield* ports.worker((client) =>
    client.PublishStatus({ importId: marker.importId }),
  );
  switch (status._tag) {
    case "committed":
      if (marker.importId === summary.importId) {
        return Option.some(yield* setAside(ports, catalogCountsOf(summary)));
      }
      yield* removePublishMarker(ports.databasePath);
      return Option.some(failed(MOVED_BEFORE_CHANGES));
    case "other":
      yield* removePublishMarker(ports.databasePath);
      return Option.some(failed(status.message));
    case "unconfirmed":
      return Option.some(failed(status.message));
    case "none":
      return Option.none<PublishOutcome>();
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
  if (Option.isSome(pending)) {
    const resumed = yield* resume(ports, pending.value, summary);
    if (Option.isSome(resumed)) return resumed.value;
  }
  yield* writePublishMarker(ports.databasePath, {
    organizationId: ports.organizationId,
    importId: summary.importId,
    startedAt: yield* Clock.currentTimeMillis,
  });
  const seal = yield* stage(ports, summary);
  if (Option.isNone(seal)) return failed(UNFINISHED);
  const committed = yield* ports.worker((client) =>
    client.PublishCommit({
      sourcePath: ports.databasePath,
      importId: summary.importId,
      seal: seal.value,
    }),
  );
  switch (committed._tag) {
    case "committed":
      return yield* setAside(ports, catalogCountsOf(summary));
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
