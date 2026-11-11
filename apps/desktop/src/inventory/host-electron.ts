import type { WorkspaceToken } from "@store/contracts/replica";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { shell } from "@/host/shell";
import { ReplicaIdentity } from "@/host/shell-rpcs";

import { catalogOpenRefused, CatalogOpenFailure } from "./errors";
import { replicaAuthorityOf, type InventoryScope } from "./host";
import { forwardedPorts, openReplicaChannel } from "./services";

const PORTS_WAIT = "15 seconds";

const decodeIdentity = Schema.decodeUnknownEffect(ReplicaIdentity);

export const openReplica = Effect.fn("ElectronInventoryHost.open")(function* (
  scope: InventoryScope,
  registry: AtomRegistry.AtomRegistry,
) {
  const client = yield* shell;
  const token = yield* Deferred.make<WorkspaceToken>();
  const workspace = Atom.make(
    Stream.unwrap(
      Effect.map(Deferred.await(token), (workspaceToken) =>
        client.WorkspaceState({ workspaceToken }),
      ),
    ),
  );
  const channel = yield* openReplicaChannel(registry, Atom.map(workspace, AsyncResult.value));
  const arrived = yield* Deferred.make<void>();
  yield* forwardedPorts(window).pipe(
    Stream.runForEach((forwarded) =>
      Deferred.await(token).pipe(
        Effect.flatMap((workspaceToken) => {
          if (forwarded.message.workspaceToken !== workspaceToken) {
            for (const port of forwarded.ports) port.close();
            return Effect.void;
          }
          return channel
            .deliver(forwarded)
            .pipe(Effect.andThen(Deferred.succeed(arrived, undefined)));
        }),
      ),
    ),
    Effect.forkScoped({ startImmediately: true }),
  );
  const opened = yield* Effect.acquireRelease(
    decodeIdentity({ ...scope, authority: replicaAuthorityOf(scope) }).pipe(
      Effect.flatMap((identity) => client.ReplicaOpen({ identity })),
      Effect.mapError(catalogOpenRefused),
    ),
    (workspaceOpened) =>
      Effect.ignore(client.ReplicaClose({ workspaceToken: workspaceOpened.workspaceToken })),
  );
  if (opened.engine !== "sqlite") {
    return yield* new CatalogOpenFailure({ reason: "engineUnavailable" });
  }
  yield* Deferred.succeed(token, opened.workspaceToken);
  yield* Deferred.await(arrived).pipe(
    Effect.timeoutOrElse({
      duration: PORTS_WAIT,
      orElse: () => Effect.fail(new CatalogOpenFailure({ reason: "portsTimeout" })),
    }),
  );
  return {
    services: channel.services,
    retryRecovery: Effect.ignore(client.ReplicaRetry({ workspaceToken: opened.workspaceToken })),
  };
});
