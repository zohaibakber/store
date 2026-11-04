import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Jwk from "effect/jose/Jwk";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { issueAccessToken, makeAccessTokenVerifier } from "../src/jwt";
import { EmailAddress, OrganizationId, SessionId, UserId } from "../src/model";
import { layer as webCryptoLayer } from "../src/web-crypto";

const AUTH_JWT_KEY_ID = "test-key";

const NEXT_KEY_ID = "tabaaq-auth-next";

const encodeHeader = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({ alg: Schema.String, typ: Schema.Literal("JWT"), kid: Schema.String }),
  ),
);

const generateKeyPair = (kid: string) =>
  Effect.gen(function* () {
    const pair = yield* Jwk.generateKeyPair({ algorithm: "ES256", kid });
    return {
      publicKey: yield* Jwk.importPublic(pair.publicKey, "ES256"),
      signer: yield* Jwk.importPrivate(pair.privateKey, "ES256"),
    };
  });

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

layer(webCryptoLayer)("ES256 access tokens", (it) => {
  it.effect("accepts only ES256 tokens signed by the ring key their key id names", () =>
    Effect.gen(function* () {
      const current = yield* generateKeyPair(AUTH_JWT_KEY_ID);
      const next = yield* generateKeyPair(NEXT_KEY_ID);
      const ring = { keys: [current.publicKey, next.publicKey] };
      const verify = yield* makeAccessTokenVerifier(ring);
      const fromCurrent = yield* issueAccessToken(input, {
        ...ring,
        signer: current.signer,
      });
      const fromNext = yield* issueAccessToken(
        { ...input, sessionId: SessionId.make("session-2") },
        { ...ring, signer: next.signer },
      );
      const [, claims] = fromCurrent.token.split(".");
      const [, , foreignSignature] = fromNext.token.split(".");
      const refusal = (header: { readonly alg: string; readonly kid: string }) =>
        Effect.map(
          Effect.flip(
            verify(
              `${Base64Url.encode(encodeHeader({ ...header, typ: "JWT" }))}.${claims}.${foreignSignature}`,
            ),
          ),
          (failure) => failure.reason,
        );

      const accepted = yield* Effect.all([verify(fromCurrent.token), verify(fromNext.token)]);
      const refused = yield* Effect.all({
        signedByAnotherRingKey: refusal({ alg: "ES256", kid: AUTH_JWT_KEY_ID }),
        unknownKeyId: refusal({ alg: "ES256", kid: "tabaaq-auth-unknown" }),
        unsignedAlgorithm: refusal({ alg: "none", kid: AUTH_JWT_KEY_ID }),
        symmetricAlgorithm: refusal({ alg: "HS256", kid: AUTH_JWT_KEY_ID }),
      });

      expect(accepted.map((verified) => verified.sessionId)).toEqual(["session-1", "session-2"]);
      expect(refused).toEqual({
        signedByAnotherRingKey: "InvalidSignature",
        unknownKeyId: "UnknownKey",
        unsignedAlgorithm: "Malformed",
        symmetricAlgorithm: "InvalidSignature",
      });
    }),
  );

  it.effect("refuses a token once it expires", () =>
    Effect.gen(function* () {
      const pair = yield* generateKeyPair(AUTH_JWT_KEY_ID);
      const ring = { keys: [pair.publicKey] };
      const signing = {
        ...ring,
        signer: pair.signer,
        accessTokenTtlSeconds: 600,
      };
      const verify = yield* makeAccessTokenVerifier(ring);
      const issued = yield* issueAccessToken(input, signing);

      yield* TestClock.adjust("599 seconds");
      expect((yield* verify(issued.token)).sessionId).toBe("session-1");
      yield* TestClock.adjust("1 second");

      expect((yield* Effect.flip(verify(issued.token))).reason).toBe("Expired");
    }),
  );
});
