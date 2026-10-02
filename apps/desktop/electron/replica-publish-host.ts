import { InventorySubsetSummarySpec } from "@store/client-db/subset-spec";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

import type { LocalCatalogReport } from "../src/lib/local-catalog-standing";
import type { PublishOffer, PublishOutcome } from "../src/lib/workspace-publish";
import { PUBLISH_PROGRESS_CHANNEL } from "./publish-channels";
import {
  discardPublish,
  publishLocalWorkspace,
  readLocalCatalog,
  readPublishOffer,
  type PublishPorts,
} from "./replica-publish";
import { ReplicaWorkerFailure } from "./replica-rpc";
import { sendToRenderer, type ReplicaSession, type ReplicaSessions } from "./replica-sessions";

export type ReplicaPublishHost = {
  readonly offer: (
    session: ReplicaSession | undefined,
    organizationId: string,
  ) => Effect.Effect<PublishOffer>;
  readonly publish: (
    session: ReplicaSession | undefined,
    organizationId: string,
  ) => Effect.Effect<PublishOutcome>;
  readonly discard: (
    session: ReplicaSession | undefined,
    organizationId: string,
  ) => Effect.Effect<PublishOffer>;
  readonly localCatalog: (session: ReplicaSession | undefined) => Effect.Effect<LocalCatalogReport>;
};

const PUBLISH_NEEDS_ORGANIZATION = "Open the organization that should receive this device's data.";

const PUBLISH_LOCAL_OPEN = "Close the workspace on this device before moving its data.";

const PUBLISH_UNDERWAY = "This device's data is already being moved.";

const NO_PUBLISH_OFFER: PublishOffer = { _tag: "none" };

const UNKNOWN_LOCAL_CATALOG: LocalCatalogReport = { _tag: "unknown" };

const CATALOG_SOURCES = InventorySubsetSummarySpec.fields.source.literals;

const failed = (message: string) => ({ _tag: "failed" as const, message });

const messageOf = (cause: { readonly message: string }) => cause.message;

export const makeReplicaPublishHost = (sessions: ReplicaSessions): ReplicaPublishHost => {
  const publishTurn = Semaphore.makeUnsafe(1);

  const portsFor = (session: ReplicaSession, organizationId: string): PublishPorts => ({
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

  const readOpenCatalog = (session: ReplicaSession): Effect.Effect<LocalCatalogReport> =>
    sessions
      .whenOpen(session, (current) =>
        Effect.findFirst(CATALOG_SOURCES, (source) =>
          current.admission
            .read(
              current.reader.useIdempotent((reader) =>
                reader.client.SummarizeSubset({ spec: { source, distinct: [] } }),
              ),
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
    session: ReplicaSession | undefined,
    organizationId: string,
    use: (ports: PublishPorts) => Effect.Effect<A>,
    otherwise: (message: string) => A,
  ): Effect.Effect<A> =>
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
      withLocalReplicaClosed(session, organizationId, readPublishOffer, () => NO_PUBLISH_OFFER),
    publish: (session, organizationId) =>
      publishTurn
        .withPermitsIfAvailable(1)(
          withLocalReplicaClosed(session, organizationId, publishLocalWorkspace, failed),
        )
        .pipe(Effect.map(Option.getOrElse(() => failed(PUBLISH_UNDERWAY)))),
    discard: (session, organizationId) =>
      publishTurn
        .withPermitsIfAvailable(1)(
          withLocalReplicaClosed(session, organizationId, discardPublish, () => NO_PUBLISH_OFFER),
        )
        .pipe(Effect.map(Option.getOrElse(() => NO_PUBLISH_OFFER))),
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
