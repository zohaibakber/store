import path from "node:path";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { shippedLicenceTrust, type LicenceTrust } from "@store/licence";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import type * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { DesktopAuth, type DesktopAuthOptions } from "./auth";
import { cachedOnSuccess } from "./cached-on-success";
import { DesktopShell } from "./desktop-shell";
import { LicenceService } from "./licence/service";
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

const LicenceLive = (options: { readonly directory: string; readonly trust: LicenceTrust }) =>
  Layer.effect(
    LicenceService,
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const platform = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
      const built = yield* cachedOnSuccess(
        Layer.buildWithScope(
          LicenceService.layer(options).pipe(Layer.provide(Layer.succeedContext(platform))),
          scope,
        ).pipe(Effect.map(Context.get(LicenceService)), Effect.uninterruptible),
      );
      return LicenceService.of({
        current: Effect.flatMap(built, (licence) => licence.current),
        states: Stream.unwrap(Effect.map(built, (licence) => licence.states)),
        enter: (text, databaseShop) =>
          Effect.flatMap(built, (licence) => licence.enter(text, databaseShop)),
      });
    }),
  );

const ReplicaHostLive = Layer.effect(
  ReplicaHost,
  Effect.gen(function* () {
    const auth = yield* DesktopAuth;
    const licence = yield* LicenceService;
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
      sessions: { licence },
    });
  }),
);

const MainLive = (options: DesktopHostOptions) =>
  ShellServer.layer.pipe(
    Layer.provideMerge(ReplicaHostLive),
    Layer.provideMerge(
      Layer.mergeAll(
        DesktopAuth.layer(options),
        LicenceLive({
          directory: path.join(options.shell.userDataPath, "licence"),
          trust: shippedLicenceTrust(options.packaged),
        }),
        Layer.succeed(DesktopShell, options.shell),
        options.packaged ? Updater.layer : Updater.layerUnpackaged,
      ),
    ),
    Layer.provideMerge(ShellEvents.layer),
    Layer.provideMerge(PrivateFiles.layerWithPlatform.pipe(Layer.provideMerge(PlatformLive))),
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
