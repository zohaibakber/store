import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

const PRIVATE_FILE = 0o600;

export const readPrivateText = Effect.fn("LicenceFiles.read")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(file).pipe(
    Effect.map((text) => Option.some(text.trim())),
    Effect.catchIf(
      (failure) => failure.reason._tag === "NotFound",
      () => Effect.succeed(Option.none<string>()),
    ),
  );
});

export const replacePrivateText = Effect.fn("LicenceFiles.replace")(function* (
  file: string,
  text: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const temporary = `${file}.tmp`;
  yield* fs.makeDirectory(path.dirname(file), { recursive: true });
  yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* fs.open(temporary, { flag: "w", mode: PRIVATE_FILE });
      yield* handle.writeAll(new TextEncoder().encode(`${text}\n`));
      yield* handle.sync;
    }),
  ).pipe(
    Effect.andThen(fs.rename(temporary, file)),
    Effect.onError(() => Effect.ignore(fs.remove(temporary, { force: true }))),
  );
});
