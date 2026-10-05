import path from "node:path";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { shippedLicenceTrust } from "@store/licence";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";

import { LicenceService } from "./service";

export const makeLicenceHost = (options: {
  readonly userDataPath: string;
  readonly packaged: boolean;
}) => {
  const runtime = ManagedRuntime.make(
    LicenceService.layer({
      directory: path.join(options.userDataPath, "licence"),
      trust: shippedLicenceTrust(options.packaged),
    }).pipe(Layer.provide([NodeFileSystem.layer, NodePath.layer])),
  );
  const built = Effect.map(runtime.contextEffect, Context.get(LicenceService));
  const service: LicenceService["Service"] = {
    current: Effect.flatMap(built, (licence) => licence.current),
    states: Stream.unwrap(Effect.map(built, (licence) => licence.states)),
    enter: (text, databaseShop) =>
      Effect.flatMap(built, (licence) => licence.enter(text, databaseShop)),
  };
  return { service, dispose: () => runtime.dispose() };
};
