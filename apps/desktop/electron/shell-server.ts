import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as RpcServer from "effect/rpc/RpcServer";
import type { MessagePortMain } from "electron";

import { ShellRpcs } from "../src/host/shell-rpcs";
import { DesktopAuth } from "./auth";
import { DesktopShell, ShellConnection, type ShellSender } from "./desktop-shell";
import { layerMessagePortMain } from "./message-port-main-runner";
import { PrivateFiles } from "./private-files";
import { ReplicaHost } from "./replica-host";
import { ShellEvents } from "./shell-events";
import { ShellHandlersLive } from "./shell-handlers";
import { Updater } from "./updater";

const layerShellServer = (port: MessagePortMain, sender: ShellSender) =>
  RpcServer.layer(ShellRpcs).pipe(
    Layer.provide(ShellHandlersLive),
    Layer.provide(Layer.succeed(ShellConnection, { sender })),
    Layer.provide(RpcServer.layerProtocolWorkerRunner),
    Layer.provide(layerMessagePortMain(port)),
  );

export class ShellServer extends Context.Service<
  ShellServer,
  {
    readonly serve: (sender: ShellSender, port: MessagePortMain) => Effect.Effect<void>;
    readonly release: (senderId: number) => Effect.Effect<void>;
  }
>()("@store/desktop/ShellServer") {
  static readonly layer = Layer.effect(
    ShellServer,
    Effect.gen(function* () {
      const fibers = yield* FiberMap.make<number>();
      const services = yield* Effect.context<
        | DesktopAuth
        | DesktopShell
        | ReplicaHost
        | ShellEvents
        | Updater
        | Crypto.Crypto
        | FileSystem.FileSystem
        | Path.Path
        | PrivateFiles
      >();
      return ShellServer.of({
        serve: (sender, port) =>
          FiberMap.run(
            fibers,
            sender.id,
            Layer.launch(Layer.fresh(layerShellServer(port, sender))).pipe(
              Effect.provideContext(services),
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.void
                  : Effect.logDebug("ShellServer.ended", cause),
              ),
            ),
          ).pipe(Effect.asVoid),
        release: (senderId) => FiberMap.remove(fibers, senderId),
      });
    }),
  );
}
