import { analyticsDatabasePath } from "@store/client-db/node-analytics";
import type { OrganizationId } from "@store/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { ReplicaFileRefused } from "../src/host/file-refusal";
import type { CatalogCounts } from "../src/host/workspace-backup";
import type {
  LocalCatalogReport,
  PublishOffer,
  PublishProgress,
  Published,
} from "../src/host/workspace-publish";
import {
  archiveReplicaFile,
  readPublishMarker,
  removePublishMarker,
  replicaFileExists,
  writePublishMarker,
  type PublishMarker,
} from "./replica-publish-files";
import { asFileRefusal } from "./replica-refusal";
import { removeReplicaFile } from "./replica-restore-files";
import { catalogCountsOf, type ReplicaPublishSummary } from "./replica-rpc";
import type { ReplicaWorkerClient } from "./replica-supervisor";

type PublishClient = Pick<
  ReplicaWorkerClient,
  "PublishSummary" | "PublishStage" | "PublishCommit" | "PublishStatus"
>;

export type PublishPorts = {
  readonly organizationId: OrganizationId;
  readonly databasePath: string;
  readonly worker: <A, E extends ReplicaFileRefused | { readonly message: string }>(
    use: (client: PublishClient) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, ReplicaFileRefused>;
  readonly progress: (progress: PublishProgress) => Effect.Effect<void>;
};

type Summary = typeof ReplicaPublishSummary.Type;

type Standing =
  | { readonly _tag: "absent" }
  | {
      readonly _tag: "elsewhere";
      readonly organizationId: OrganizationId;
      readonly summary: Summary;
    }
  | {
      readonly _tag: "here";
      readonly summary: Summary;
      readonly pending: Option.Option<PublishMarker>;
    };

export const NO_OFFER: PublishOffer = { _tag: "none" };

type PublishDone = typeof Published.Type;

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
): Effect.Effect<LocalCatalogReport, never, FileSystem.FileSystem> =>
  replicaFileExists(ports.databasePath).pipe(
    Effect.flatMap((exists) =>
      exists
        ? ports
            .worker((client) => client.PublishSummary({ sourcePath: ports.databasePath }))
            .pipe(Effect.map((summary) => summary.rows))
        : Effect.succeed(0),
    ),
    Effect.map((rows): LocalCatalogReport => ({ _tag: rows > 0 ? "stocked" : "empty" })),
    Effect.tapError((failure) => Effect.logWarning("ReplicaPublish.catalog_unread", failure)),
    Effect.catch(() => Effect.succeed<LocalCatalogReport>({ _tag: "unknown" })),
  );

export const readPublishOffer = (
  ports: PublishPorts,
): Effect.Effect<PublishOffer, never, FileSystem.FileSystem> =>
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
    Effect.tapError((failure) => Effect.logWarning("ReplicaPublish.offer_unread", failure)),
    Effect.catch(() => Effect.succeed(NO_OFFER)),
  );

export const discardPublish = (
  ports: PublishPorts,
): Effect.Effect<PublishOffer, never, FileSystem.FileSystem> =>
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
  return { _tag: "published", counts } satisfies PublishDone;
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
      return yield* new ReplicaFileRefused({ reason: "moved-before-changes" });
    case "other":
      yield* removePublishMarker(ports.databasePath);
      return yield* new ReplicaFileRefused({ reason: "failed", detail: status.message });
    case "unconfirmed":
      return yield* new ReplicaFileRefused({ reason: "failed", detail: status.message });
    case "none":
      return Option.none<PublishDone>();
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
  if (Option.isNone(seal)) return yield* new ReplicaFileRefused({ reason: "unfinished-read" });
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
      return yield* new ReplicaFileRefused({ reason: "failed", detail: committed.message });
    case "unconfirmed":
      return yield* new ReplicaFileRefused({ reason: "failed", detail: committed.message });
  }
});

export const publishLocalWorkspace = (
  ports: PublishPorts,
): Effect.Effect<PublishDone, ReplicaFileRefused, FileSystem.FileSystem> =>
  readStanding(ports).pipe(
    Effect.flatMap((standing) => {
      switch (standing._tag) {
        case "absent":
          return Effect.fail(new ReplicaFileRefused({ reason: "nothing-to-move" }));
        case "elsewhere":
          return Effect.fail(new ReplicaFileRefused({ reason: "moving-elsewhere" }));
        case "here":
          return publishFrom(ports, standing.summary, standing.pending);
      }
    }),
    Effect.mapError(asFileRefusal),
  );
