import {
  catalogOpenRefused,
  CatalogOpenFailure,
  forwardedPorts,
  openReplicaChannel,
  replicaAuthorityOf,
  type InventoryHost,
  type ReplicaOpenIdentity,
} from "@store/inventory-react";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Stream from "effect/Stream";

import { appHost } from "@/host";

const PORTS_WAIT = "15 seconds";

export const createElectronInventoryHost = async (): Promise<InventoryHost> => {
  const { inventoryHttp, replica } = appHost();
  const config = await inventoryHttp.getConfig();
  return {
    apiBaseUrl: config.apiBaseUrl,
    deviceId: config.deviceId,
    open: Effect.fn("ElectronInventoryHost.open")(function* (
      identity: ReplicaOpenIdentity,
      registry: AtomRegistry.AtomRegistry,
    ) {
      const channel = yield* openReplicaChannel(registry);
      const arrived = yield* Deferred.make<void>();
      const token = yield* Deferred.make<string>();
      yield* forwardedPorts(window).pipe(
        Stream.runForEach((forwarded) =>
          Deferred.await(token).pipe(
            Effect.flatMap((workspaceToken) => {
              if (forwarded.message.workspaceToken !== workspaceToken) {
                for (const port of forwarded.ports) port.close();
                return Effect.void;
              }
              channel.deliver(forwarded);
              return Deferred.succeed(arrived, undefined);
            }),
          ),
        ),
        Effect.forkScoped({ startImmediately: true }),
      );
      const opened = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => replica.open({ ...identity, authority: replicaAuthorityOf(identity) }),
          catch: catalogOpenRefused,
        }),
        (workspaceOpened) =>
          Effect.ignore(Effect.tryPromise(() => replica.close(workspaceOpened.workspaceToken))),
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
        retryRecovery: Effect.ignore(
          Effect.tryPromise(() => replica.retryRecovery(opened.workspaceToken)),
        ),
      };
    }),
  };
};
