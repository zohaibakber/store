import {
  catalogOpenFailure,
  deliverPorts,
  desktopServices,
  forwardedPorts,
  replicaAuthorityOf,
  type InventoryHost,
} from "@store/inventory-react";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { InventoryHttpConfig } from "@/host/electron";

const PORTS_WAIT = "15 seconds";

const NO_ENGINE = "Native Electron replica SQLite is unavailable.";

const NO_PORTS = "The local database did not answer. Try again.";

export const createElectronInventoryHost = async (): Promise<InventoryHost | undefined> => {
  const http = window.inventoryHttp;
  const replica = window.replica;
  if (!http || !replica) return undefined;
  const config = Schema.decodeUnknownSync(InventoryHttpConfig)(await http.getConfig());
  return {
    apiBaseUrl: config.apiBaseUrl,
    deviceId: config.deviceId,
    services: desktopServices,
    open: (identity, registry) =>
      Effect.gen(function* () {
        const arrived = yield* Deferred.make<void>();
        const token = yield* Deferred.make<string>();
        yield* forwardedPorts(window).pipe(
          Stream.runForEach((forwarded) =>
            Effect.map(Deferred.await(token), (workspaceToken) => {
              if (forwarded.message.workspaceToken !== workspaceToken) {
                for (const port of forwarded.ports) port.close();
                return;
              }
              deliverPorts(registry, forwarded);
              Deferred.doneUnsafe(arrived, Effect.void);
            }),
          ),
          Effect.forkScoped({ startImmediately: true }),
        );
        const opened = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => replica.open({ ...identity, authority: replicaAuthorityOf(identity) }),
            catch: catalogOpenFailure,
          }),
          (workspaceOpened) =>
            Effect.ignore(Effect.tryPromise(() => replica.close(workspaceOpened.workspaceToken))),
        );
        if (opened.engine !== "sqlite") return yield* catalogOpenFailure(new Error(NO_ENGINE));
        yield* Deferred.succeed(token, opened.workspaceToken);
        yield* Deferred.await(arrived).pipe(
          Effect.timeout(PORTS_WAIT),
          Effect.mapError(() => catalogOpenFailure(new Error(NO_PORTS))),
        );
        return {
          retryRecovery: Effect.ignore(
            Effect.tryPromise(() => replica.retryRecovery(opened.workspaceToken)),
          ),
        };
      }),
  };
};
