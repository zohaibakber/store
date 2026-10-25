import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";

const PRIVATE_FILE = 0o600;

const orNone = <A>(read: Effect.Effect<A, PlatformError.PlatformError>) =>
  read.pipe(
    Effect.map(Option.some),
    Effect.catchIf(
      (failure) => failure.reason._tag === "NotFound",
      () => Effect.succeed(Option.none<A>()),
    ),
  );

export class PrivateFiles extends Context.Service<
  PrivateFiles,
  {
    readonly readBytes: (
      file: string,
    ) => Effect.Effect<Option.Option<Uint8Array>, PlatformError.PlatformError>;
    readonly readText: (
      file: string,
    ) => Effect.Effect<Option.Option<string>, PlatformError.PlatformError>;
    readonly replace: (
      file: string,
      contents: Uint8Array,
    ) => Effect.Effect<void, PlatformError.PlatformError>;
    readonly replaceText: (
      file: string,
      text: string,
    ) => Effect.Effect<void, PlatformError.PlatformError>;
    readonly remove: (file: string) => Effect.Effect<void, PlatformError.PlatformError>;
  }
>()("@store/desktop/PrivateFiles") {
  static readonly layerWithPlatform = Layer.effect(
    PrivateFiles,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const crypto = yield* Crypto.Crypto;

      const readBytes = Effect.fn("PrivateFiles.readBytes")(function* (file: string) {
        return yield* orNone(fs.readFile(file));
      });

      const readText = Effect.fn("PrivateFiles.readText")(function* (file: string) {
        return Option.map(yield* orNone(fs.readFileString(file)), (text) => text.trim());
      });

      const replace = Effect.fn("PrivateFiles.replace")(function* (
        file: string,
        bytes: Uint8Array,
      ) {
        const temporary = `${file}.${yield* crypto.randomUUIDv4()}.tmp`;
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* fs.open(temporary, { flag: "wx", mode: PRIVATE_FILE });
            yield* handle.writeAll(bytes);
            yield* handle.sync;
          }),
        ).pipe(
          Effect.andThen(fs.rename(temporary, file)),
          Effect.onError(() => Effect.ignore(fs.remove(temporary, { force: true }))),
        );
      });

      const replaceText = (file: string, text: string) =>
        replace(file, new TextEncoder().encode(text));

      const remove = Effect.fn("PrivateFiles.remove")(function* (file: string) {
        yield* fs.remove(file, { force: true });
      });

      return PrivateFiles.of({ readBytes, readText, replace, replaceText, remove });
    }),
  );

  static readonly layer = PrivateFiles.layerWithPlatform.pipe(
    Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeCrypto.layer)),
  );
}
