import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { PrivateFiles } from "./private-files";

const validDeviceId = (value: string) => value.length > 0 && value.length <= 200;

const loadDeviceIdEffect = Effect.fn("DeviceId.load")(function* (userDataDirectory: string) {
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const file = path.join(userDataDirectory, "device-id");
  const files = yield* PrivateFiles;
  const stored = yield* files.readText(file).pipe(
    Effect.map(Option.filter(validDeviceId)),
    Effect.orElseSucceed(() => Option.none<string>()),
  );
  if (Option.isSome(stored)) return stored.value;
  const created = yield* crypto.randomUUIDv4();
  yield* files.replaceText(file, created);
  return created;
});

export const loadDeviceId = (userDataDirectory: string) =>
  Effect.runPromise(
    loadDeviceIdEffect(userDataDirectory).pipe(
      Effect.provide([PrivateFiles.layer, NodePath.layer, NodeCrypto.layer]),
    ),
  );
