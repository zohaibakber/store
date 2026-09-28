import { AuthJwks, publicJwks } from "@store/auth";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export const JWKS_ASSET_PATH = "/.well-known/jwks.json";
export const JWKS_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

export const jwksAssetHeaders = `${JWKS_ASSET_PATH}\n  Cache-Control: ${JWKS_CACHE_CONTROL}\n`;

const encodeJwks = Schema.encodeEffect(Schema.fromJsonString(AuthJwks));

export const writeJwksAssets = Effect.fn("AuthJwks.writeAssets")(function* (
  directory: string,
  publicJwk: JsonWebKey,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(directory, ...JWKS_ASSET_PATH.split("/"));
  yield* fs.makeDirectory(path.dirname(file), { recursive: true });
  yield* fs.writeFileString(file, yield* encodeJwks(publicJwks(publicJwk)));
  return { directory, headers: jwksAssetHeaders };
});
