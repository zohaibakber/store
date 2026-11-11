import { ReplicaId } from "@store/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { PrivateFiles } from "./private-files";

export const loadDeviceId = Effect.fn("DeviceId.load")(function* (userDataDirectory: string) {
  const path = yield* Path.Path;
  const crypto = yield* SecureRandom.SecureRandom;
  const file = path.join(userDataDirectory, "device-id");
  const files = yield* PrivateFiles;
  const stored = yield* files.readText(file).pipe(
    Effect.map(Option.filter(Schema.is(ReplicaId))),
    Effect.orElseSucceed(() => Option.none<ReplicaId>()),
  );
  if (Option.isSome(stored)) return stored.value;
  const created = ReplicaId.make(yield* crypto.uuidV4());
  yield* files.replaceText(file, created);
  return created;
});
