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
import * as Stream from "effect/Stream";
import type { BrowserWindow } from "electron";

import { DesktopAuth, type DesktopAuthOptions } from "./auth";
import { LicenceService } from "./licence/service";
import { PrivateFiles } from "./private-files";
import { UpdaterLive } from "./updater";

export interface DesktopHostOptions extends DesktopAuthOptions {
  readonly userDataPath: string;
  readonly packaged: boolean;
  readonly getWindow: () => BrowserWindow | null;
  readonly allowedOrigins: () => ReadonlyArray<string>;
}

const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeCrypto.layer);

const LicenceLive = (options: { readonly directory: string; readonly trust: LicenceTrust }) =>
  Layer.effect(
    LicenceService,
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      const platform = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
      const built = yield* Effect.cached(
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

const MainLive = (options: DesktopHostOptions) =>
  Layer.mergeAll(
    DesktopAuth.layer(options),
    LicenceLive({
      directory: path.join(options.userDataPath, "licence"),
      trust: shippedLicenceTrust(options.packaged),
    }),
    options.packaged ? UpdaterLive(options) : Layer.empty,
  ).pipe(Layer.provideMerge(PrivateFiles.layerWithPlatform.pipe(Layer.provideMerge(PlatformLive))));

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
