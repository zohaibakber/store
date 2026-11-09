import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as PubSub from "effect/PubSub";

import { DesktopAuth, type DesktopAuthOptions } from "./auth";
import { DesktopShell } from "./desktop-shell";
import { PrivateFiles } from "./private-files";
import { makeReplicaHost, ReplicaHost } from "./replica-host";
import { ShellEvents } from "./shell-events";
import { ShellServer } from "./shell-server";
import { Updater } from "./updater";

export interface DesktopHostOptions extends DesktopAuthOptions {
  readonly packaged: boolean;
  readonly shell: DesktopShell["Service"];
}

const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeCrypto.layer);

const ReplicaHostLive = Layer.effect(
  ReplicaHost,
  Effect.gen(function* () {
    const auth = yield* DesktopAuth;
    const events = yield* ShellEvents;
    const shell = yield* DesktopShell;
    return yield* makeReplicaHost({
      userDataPath: shell.userDataPath,
      workerPath: shell.workerPath,
      apiBaseUrl: shell.apiBaseUrl,
      deviceLabel: shell.deviceLabel,
      accessTokens: auth,
      dialogs: shell.dialogs,
      publishProgress: (progress) => PubSub.publish(events.publishProgress, progress),
      rendererChannel: shell.rendererChannel,
    });
  }),
);

const MainLive = (options: DesktopHostOptions) =>
  ShellServer.layer.pipe(
    Layer.provideMerge(ReplicaHostLive),
    Layer.provideMerge(
      Layer.mergeAll(
        DesktopAuth.layer(options),
        Layer.succeed(DesktopShell, options.shell),
        options.packaged ? Updater.layer : Updater.layerUnpackaged,
      ),
    ),
    Layer.provideMerge(ShellEvents.layer),
    Layer.provideMerge(PrivateFiles.layer.pipe(Layer.provideMerge(PlatformLive))),
  );

export const makeDesktopHost = (options: DesktopHostOptions) => {
  const runtime = ManagedRuntime.make(MainLive(options));
  return {
    run: <A, E>(
      effect: Effect.Effect<A, E, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>,
    ) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
};

export type DesktopHost = ReturnType<typeof makeDesktopHost>;
