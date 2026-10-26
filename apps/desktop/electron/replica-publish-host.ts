import { InventorySubsetSummarySpec } from "@store/client-db/subset-spec";
import type { OrganizationId } from "@store/contracts";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

import { ReplicaFileRefused } from "../src/host/file-refusal";
import type {
  LocalCatalogReport,
  PublishOffer,
  PublishProgress,
  Published,
} from "../src/host/workspace-publish";
import type { OpenWorkspace, OpenWorkspaces } from "./open-workspaces";
import {
  discardPublish,
  NO_OFFER,
  publishLocalWorkspace,
  readLocalCatalog,
  readPublishOffer,
  type PublishPorts,
} from "./replica-publish";
import { asFileRefusal } from "./replica-refusal";

type ReplicaPublishHost = {
  readonly offer: (
    session: OpenWorkspace | undefined,
    organizationId: OrganizationId,
  ) => Effect.Effect<PublishOffer, never, FileSystem.FileSystem>;
  readonly publish: (
    session: OpenWorkspace | undefined,
    organizationId: OrganizationId,
  ) => Effect.Effect<typeof Published.Type, ReplicaFileRefused, FileSystem.FileSystem>;
  readonly discard: (
    session: OpenWorkspace | undefined,
    organizationId: OrganizationId,
  ) => Effect.Effect<PublishOffer, never, FileSystem.FileSystem>;
  readonly localCatalog: (
    session: OpenWorkspace | undefined,
  ) => Effect.Effect<LocalCatalogReport, never, FileSystem.FileSystem>;
};

const UNKNOWN_LOCAL_CATALOG: LocalCatalogReport = { _tag: "unknown" };

const CATALOG_SOURCES = InventorySubsetSummarySpec.fields.source.literals;

export const makeReplicaPublishHost = (
  sessions: OpenWorkspaces,
  publishProgress: (progress: PublishProgress) => Effect.Effect<void>,
): ReplicaPublishHost => {
  const publishTurn = Semaphore.makeUnsafe(1);

  const portsFor = (session: OpenWorkspace, organizationId: OrganizationId): PublishPorts => ({
    organizationId,
    databasePath: sessions.localDatabasePath,
    worker: (use) =>
      sessions
        .whenOpen(session, (current) => current.supervisor.use((worker) => use(worker.client)))
        .pipe(Effect.mapError(asFileRefusal)),
    progress: publishProgress,
  });

  const readOpenCatalog = (session: OpenWorkspace): Effect.Effect<LocalCatalogReport> =>
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
        Effect.tapError((failure) =>
          Effect.logWarning("ReplicaPublishHost.catalog_unread", failure),
        ),
        Effect.catch(() => Effect.succeed(UNKNOWN_LOCAL_CATALOG)),
      );

  const withLocalReplicaClosed = <A, E>(
    session: OpenWorkspace | undefined,
    organizationId: OrganizationId,
    use: (ports: PublishPorts) => Effect.Effect<A, E, FileSystem.FileSystem>,
  ): Effect.Effect<A, E | ReplicaFileRefused, FileSystem.FileSystem> =>
    Effect.scoped(
      Effect.gen(function* () {
        if (
          session === undefined ||
          session.identity.authority !== "remote" ||
          session.identity.organizationId !== organizationId
        ) {
          return yield* new ReplicaFileRefused({ reason: "publish-needs-organization" });
        }
        yield* sessions.ownership
          .claim(sessions.localDatabasePath)
          .pipe(Effect.mapError(asFileRefusal));
        if (yield* sessions.holdsDatabase(sessions.localDatabasePath)) {
          return yield* new ReplicaFileRefused({ reason: "publish-local-open" });
        }
        return yield* use(portsFor(session, organizationId));
      }),
    );

  return {
    offer: (session, organizationId) =>
      withLocalReplicaClosed(session, organizationId, readPublishOffer).pipe(
        Effect.catch(() => Effect.succeed(NO_OFFER)),
      ),
    publish: (session, organizationId) =>
      publishTurn
        .withPermitsIfAvailable(1)(
          withLocalReplicaClosed(session, organizationId, publishLocalWorkspace),
        )
        .pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new ReplicaFileRefused({ reason: "publish-underway" })),
              onSome: Effect.succeed,
            }),
          ),
        ),
    discard: (session, organizationId) =>
      publishTurn
        .withPermitsIfAvailable(1)(
          withLocalReplicaClosed(session, organizationId, discardPublish).pipe(
            Effect.catch(() => Effect.succeed(NO_OFFER)),
          ),
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
          ).pipe(Effect.catch(() => Effect.succeed(UNKNOWN_LOCAL_CATALOG)));
      }
    },
  };
};
