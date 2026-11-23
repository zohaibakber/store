import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";

import { DesktopAuth, type DesktopAuthOptions } from "./auth";
import { DesktopShell } from "./desktop-shell";
import { layerDesktopShell, type DesktopShellConfig } from "./desktop-shell-live";
import { PrivateFiles } from "./private-files";
import { makeReplicaHost, ReplicaHost } from "./replica-host";
import { ShellEvents } from "./shell-events";
import { ShellServer } from "./shell-server";
import { Updater } from "./updater";

export interface DesktopHostConfig extends DesktopAuthOptions, DesktopShellConfig {
  readonly packaged: boolean;
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

/**
 * The main process's services once the app is ready. `ShellEvents` and
 * `MainWindow` come from the program, which needs them before ready.
 */
export const layerDesktopHost = (config: DesktopHostConfig) =>
  ShellServer.layer.pipe(
    Layer.provideMerge(ReplicaHostLive),
    Layer.provideMerge(
      Layer.mergeAll(
        DesktopAuth.layer(config),
        layerDesktopShell(config),
        config.packaged ? Updater.layer : Updater.layerUnpackaged,
      ),
    ),
    Layer.provideMerge(PrivateFiles.layer.pipe(Layer.provideMerge(PlatformLive))),
  );
