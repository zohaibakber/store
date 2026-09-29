import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthJwks, publicJwks } from "@store/auth";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it } from "vitest";

import { writeJwksAssets } from "../src/jwks-asset";

const directories: Array<string> = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("JWKS static asset", () => {
  it("writes the public JWKS at the well-known path with a cache rule", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "auth-jwks-assets-"));
    directories.push(directory);
    const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const assets = await Effect.runPromise(
      writeJwksAssets(directory, publicJwk).pipe(Effect.provide(NodeServices.layer)),
    );
    const written = await readFile(path.join(directory, ".well-known", "jwks.json"), "utf8");

    expect(assets.directory).toBe(directory);
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(AuthJwks))(written)).toEqual(
      publicJwks(publicJwk),
    );
    expect(written).not.toContain('"d"');
    expect(assets.headers).toBe(
      "/.well-known/jwks.json\n  Cache-Control: public, max-age=3600, stale-while-revalidate=86400\n",
    );
  });
});
