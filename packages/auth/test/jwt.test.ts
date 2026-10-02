import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { AUTH_JWT_KEY_ID, issueAccessToken, makeAccessTokenVerifier } from "../src/jwt";
import { EmailAddress, OrganizationId, SessionId, UserId } from "../src/model";

const NEXT_KEY_ID = "tabaaq-auth-next";
const textEncoder = new TextEncoder();

const encodeHeader = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({ alg: Schema.String, typ: Schema.Literal("JWT"), kid: Schema.String }),
  ),
);

const generateKeyPair = async () => {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  return {
    privateKey: keyPair.privateKey,
    privateJwk: await crypto.subtle.exportKey("jwk", keyPair.privateKey),
    publicJwk: await crypto.subtle.exportKey("jwk", keyPair.publicKey),
  };
};

const signedWith = (privateKey: CryptoKey) => (data: Uint8Array<ArrayBuffer>) =>
  crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, data);

const macWith = (publicJwk: JsonWebKey) => async (data: Uint8Array<ArrayBuffer>) =>
  crypto.subtle.sign(
    "HMAC",
    await crypto.subtle.importKey(
      "raw",
      textEncoder.encode(`${publicJwk.x}${publicJwk.y}`),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    ),
    data,
  );

const input = {
  subject: UserId.make("user-1"),
  sessionId: SessionId.make("session-1"),
  activeOrganizationId: OrganizationId.make("organization-1"),
  organizationName: "Owner's Store",
  role: "owner" as const,
  email: EmailAddress.make("owner@example.com"),
  name: "Owner",
  image: null,
};

describe("ES256 access tokens", () => {
  it("accepts only ES256 tokens signed by the ring key their key id names", async () => {
    const current = await generateKeyPair();
    const next = await generateKeyPair();
    const ring = {
      issuer: "https://auth.example.com",
      audience: "tabaaq-api",
      keys: [
        { kid: AUTH_JWT_KEY_ID, jwk: current.publicJwk },
        { kid: NEXT_KEY_ID, jwk: next.publicJwk },
      ],
    };

    const [accepted, refused] = await Effect.runPromise(
      Effect.gen(function* () {
        const verify = yield* makeAccessTokenVerifier(ring);
        const fromCurrent = yield* issueAccessToken(input, {
          ...ring,
          activeKeyId: AUTH_JWT_KEY_ID,
          privateJwk: current.privateJwk,
        });
        const fromNext = yield* issueAccessToken(
          { ...input, sessionId: SessionId.make("session-2") },
          { ...ring, activeKeyId: NEXT_KEY_ID, privateJwk: next.privateJwk },
        );
        const claims = fromCurrent.token.split(".")[1];
        const refusal = (
          header: { readonly alg: string; readonly kid: string },
          sign: (data: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>,
        ) =>
          Effect.gen(function* () {
            const signingInput = `${Encoding.encodeBase64Url(encodeHeader({ ...header, typ: "JWT" }))}.${claims}`;
            const signature = yield* Effect.promise(() => sign(textEncoder.encode(signingInput)));
            const token = `${signingInput}.${Encoding.encodeBase64Url(new Uint8Array(signature))}`;
            return (yield* Effect.flip(verify(token))).reason;
          });
        return [
          yield* Effect.all([verify(fromCurrent.token), verify(fromNext.token)]),
          yield* Effect.all({
            signedByAnotherRingKey: refusal(
              { alg: "ES256", kid: AUTH_JWT_KEY_ID },
              signedWith(next.privateKey),
            ),
            unknownKeyId: refusal(
              { alg: "ES256", kid: "tabaaq-auth-unknown" },
              signedWith(current.privateKey),
            ),
            unsignedAlgorithm: refusal(
              { alg: "none", kid: AUTH_JWT_KEY_ID },
              signedWith(current.privateKey),
            ),
            symmetricAlgorithm: refusal(
              { alg: "HS256", kid: AUTH_JWT_KEY_ID },
              macWith(current.publicJwk),
            ),
          }),
        ] as const;
      }),
    );

    expect(accepted.map((claims) => claims.sessionId)).toEqual(["session-1", "session-2"]);
    expect(refused).toEqual({
      signedByAnotherRingKey: "InvalidSignature",
      unknownKeyId: "UnknownKey",
      unsignedAlgorithm: "InvalidClaims",
      symmetricAlgorithm: "InvalidClaims",
    });
  });
});
