import { InventorySubsetSummarySpec } from "@store/client-db/subset-spec";
import type {
  LocalCatalogReport,
  PublishOffer,
  PublishOutcome,
} from "@store/web/host/workspace-publish";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

import { PUBLISH_PROGRESS_CHANNEL } from "./ipc-channels";
import {
  discardPublish,
  failed,
  NO_OFFER,
  publishLocalWorkspace,
  readLocalCatalog,
  readPublishOffer,
  type PublishPorts,
} from "./replica-publish";
import { ReplicaWorkerFailure } from "./replica-rpc";
import {
  sendToRenderer,
  type WorkspaceSession,
  type WorkspaceSessions,
} from "./workspace-sessions";

type ReplicaPublishHost = {
  readonly offer: (
    session: WorkspaceSession | undefined,
    organizationId: string,
  ) => Effect.Effect<PublishOffer, never, FileSystem.FileSystem>;
  readonly publish: (
    session: WorkspaceSession | undefined,
    organizationId: string,
  ) => Effect.Effect<PublishOutcome, never, FileSystem.FileSystem>;
  readonly discard: (
    session: WorkspaceSession | undefined,
    organizationId: string,
  ) => Effect.Effect<PublishOffer, never, FileSystem.FileSystem>;
  readonly localCatalog: (
    session: WorkspaceSession | undefined,
  ) => Effect.Effect<LocalCatalogReport, never, FileSystem.FileSystem>;
};

const PUBLISH_NEEDS_ORGANIZATION = "Open the organization that should receive this device's data.";

const PUBLISH_LOCAL_OPEN = "Close the workspace on this device before moving its data.";

const PUBLISH_UNDERWAY = "This device's data is already being moved.";

const UNKNOWN_LOCAL_CATALOG: LocalCatalogReport = { _tag: "unknown" };

const CATALOG_SOURCES = InventorySubsetSummarySpec.fields.source.literals;

const messageOf = (cause: { readonly message: string }) => cause.message;

export const makeReplicaPublishHost = (sessions: WorkspaceSessions): ReplicaPublishHost => {
  const publishTurn = Semaphore.makeUnsafe(1);

  const portsFor = (session: WorkspaceSession, organizationId: string): PublishPorts => ({
    organizationId,
    databasePath: sessions.localDatabasePath,
    worker: (use) =>
      sessions
        .whenOpen(session, (current) => current.supervisor.use((worker) => use(worker.client)))
        .pipe(Effect.mapError((cause) => new ReplicaWorkerFailure({ message: messageOf(cause) }))),
    progress: (progress) =>
      Effect.try(() => sendToRenderer(session.sender, PUBLISH_PROGRESS_CHANNEL, progress)).pipe(
        Effect.ignore,
      ),
  });

  const readOpenCatalog = (session: WorkspaceSession): Effect.Effect<LocalCatalogReport> =>
    sessions
      .whenOpen(session, (current) =>
        Effect.findFirst(CATALOG_SOURCES, (source) =>
          current.reader
            .useIdempotent((reader) =>
              reader.client.SummarizeSubset({ spec: { source, distinct: [] } }),
            )
            .pipe(Effect.map((read) => read.summary.count > 0)),
        ),
      )
      .pipe(
        Effect.map((stocked): LocalCatalogReport => ({
          _tag: Option.isSome(stocked) ? "stocked" : "empty",
        })),
        Effect.catch(() => Effect.succeed(UNKNOWN_LOCAL_CATALOG)),
      );

  const withLocalReplicaClosed = <A>(
    session: WorkspaceSession | undefined,
    organizationId: string,
    use: (ports: PublishPorts) => Effect.Effect<A, never, FileSystem.FileSystem>,
    otherwise: (message: string) => A,
  ): Effect.Effect<A, never, FileSystem.FileSystem> =>
    Effect.scoped(
      Effect.gen(function* () {
        if (
          session === undefined ||
          session.identity.authority !== "remote" ||
          session.identity.organizationId !== organizationId
        ) {
          return otherwise(PUBLISH_NEEDS_ORGANIZATION);
        }
        yield* sessions.ownership.claim(sessions.localDatabasePath);
        if (sessions.holdsDatabase(sessions.localDatabasePath)) {
          return otherwise(PUBLISH_LOCAL_OPEN);
        }
        return yield* use(portsFor(session, organizationId));
      }),
    ).pipe(Effect.catch((cause) => Effect.succeed(otherwise(messageOf(cause)))));

  return {
    offer: (session, organizationId) =>
      withLocalReplicaClosed(session, organizationId, readPublishOffer, () => NO_OFFER),
    publish: (session, organizationId) =>
      publishTurn
        .withPermitsIfAvailable(1)(
          withLocalReplicaClosed(session, organizationId, publishLocalWorkspace, failed),
        )
        .pipe(Effect.map(Option.getOrElse(() => failed(PUBLISH_UNDERWAY)))),
    discard: (session, organizationId) =>
      publishTurn
        .withPermitsIfAvailable(1)(
          withLocalReplicaClosed(session, organizationId, discardPublish, () => NO_OFFER),
        )
        .pipe(Effect.map(Option.getOrElse(() => NO_OFFER))),
    localCatalog: (session) => {
      if (session === undefined) return Effect.succeed(UNKNOWN_LOCAL_CATALOG);
      switch (session.identity.authority) {
        case "local":
          return readOpenCatalog(session);
        case "remote":
          return withLocalReplicaClosed(
            session,
            session.identity.organizationId,
            readLocalCatalog,
            () => UNKNOWN_LOCAL_CATALOG,
          );
      }
    },
  };
};
