import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

class WebCryptoError extends Schema.TaggedError<WebCryptoError>()("Auth.WebCryptoError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

const attempt = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new WebCryptoError({ operation, cause }) });

const owned = (bytes: Uint8Array) => new Uint8Array(bytes);

const HMAC_SHA256 = { name: "HMAC", hash: "SHA-256" } as const;

const hmacKey = (key: Uint8Array, usages: ReadonlyArray<"sign" | "verify">) =>
  crypto.subtle.importKey("raw", owned(key), HMAC_SHA256, false, [...usages]);

export const layer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
    digest: (algorithm, data) =>
      Effect.tryPromise({
        try: () =>
          crypto.subtle.digest(algorithm, owned(data)).then((buffer) => new Uint8Array(buffer)),
        catch: (cause) =>
          PlatformError.badArgument({
            module: "Crypto",
            method: "digest",
            description: String(cause),
            cause,
          }),
      }),
  }),
);

export const hmacSha256 = (key: Uint8Array, message: Uint8Array) =>
  attempt(
    "hmacSha256",
    async () =>
      new Uint8Array(
        await crypto.subtle.sign(HMAC_SHA256.name, await hmacKey(key, ["sign"]), owned(message)),
      ),
  );

export const constantTimeEqual = (left: Uint8Array, right: Uint8Array) =>
  attempt("constantTimeEqual", async () => {
    const key = await hmacKey(crypto.getRandomValues(new Uint8Array(32)), ["sign", "verify"]);
    const signature = await crypto.subtle.sign(HMAC_SHA256.name, key, owned(left));
    return crypto.subtle.verify(HMAC_SHA256.name, key, signature, owned(right));
  });

export const pbkdf2Sha256 = (input: {
  readonly password: Uint8Array;
  readonly salt: Uint8Array;
  readonly iterations: number;
  readonly bytes: number;
}) =>
  attempt("pbkdf2Sha256", async () => {
    const key = await crypto.subtle.importKey("raw", owned(input.password), "PBKDF2", false, [
      "deriveBits",
    ]);
    return new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt: owned(input.salt), iterations: input.iterations },
        key,
        input.bytes * 8,
      ),
    );
  });

export const verifyRs256 = (
  key: { readonly n: string; readonly e: string },
  signature: Uint8Array,
  message: Uint8Array,
) =>
  attempt("verifyRs256", async () => {
    const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
    const imported = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: key.n, e: key.e, alg: "RS256", ext: true },
      algorithm,
      false,
      ["verify"],
    );
    return crypto.subtle.verify(algorithm.name, imported, owned(signature), owned(message));
  });
