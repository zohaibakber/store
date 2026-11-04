import { EmailAddress, normalizedEmail, type EmailAddress as EmailAddressType } from "@store/auth";
import * as Context from "effect/Context";
import * as Mac from "effect/crypto/Mac";
import * as Signature from "effect/crypto/Signature";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { constTrue } from "effect/Function";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as UrlParams from "effect/http/UrlParams";
import * as Jwks from "effect/jose/Jwks";
import * as Jwt from "effect/jose/Jwt";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import * as GoogleLinking from "./google-linking";
import { GoogleAccountId } from "./identifiers";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

const KEY_SET_TTL = Duration.hours(1);
const KEY_SET_REFETCH_COOLDOWN = Duration.minutes(1);
const GOOGLE_REQUEST_TIMEOUT = Duration.seconds(10);

const textEncoder = new TextEncoder();

const GoogleTokenResponse = Schema.Struct({
  id_token: Schema.String,
});

const GoogleTokenRefusal = Schema.Struct({
  error: Schema.String,
});

const IdTokenClaims = Schema.Struct({
  iss: Schema.String,
  aud: Schema.String,
  sub: Schema.String,
  exp: Schema.Finite,
  email: EmailAddress,
  email_verified: Schema.Union([Schema.Boolean, Schema.Literals(["true", "false"])]),
  name: Schema.optionalKey(Schema.String),
  picture: Schema.optionalKey(Schema.String),
  nonce: Schema.optionalKey(Schema.String),
  hd: Schema.optionalKey(Schema.String),
});

const isTrue = (value: boolean | "true" | "false") => value === true || value === "true";

export interface GoogleProfile {
  readonly providerAccountId: GoogleAccountId;
  readonly email: EmailAddressType;
  readonly ownsMailbox: boolean;
  readonly name: string;
  readonly image: string | null;
}

export class GoogleOAuthError extends Schema.TaggedError<GoogleOAuthError>()("GoogleOAuthError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class GoogleIdentityRejected extends Schema.TaggedError<GoogleIdentityRejected>()(
  "GoogleIdentityRejected",
  {
    reason: Schema.Literals([
      "Malformed",
      "UnknownKey",
      "Signature",
      "Issuer",
      "Audience",
      "Expired",
      "EmailUnverified",
      "Nonce",
      "Grant",
    ]),
    message: Schema.String,
  },
) {}

interface GoogleOAuthConfiguration {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string>;
  readonly callbackUrl: string;
}

const oauthError = (operation: string, cause: unknown) =>
  new GoogleOAuthError({ operation, message: String(cause), cause });

const rejected = (reason: GoogleIdentityRejected["reason"], message: string) =>
  new GoogleIdentityRejected({ reason, message });

const malformed = () => rejected("Malformed", "The identity token is malformed.");

const decodeOkJson = <A>(
  operation: string,
  schema: Schema.ConstraintDecoder<A>,
  response: HttpClientResponse.HttpClientResponse,
) =>
  HttpClientResponse.matchStatus({
    "2xx": (ok) =>
      HttpClientResponse.schemaBodyJson(schema)(ok).pipe(
        Effect.mapError((cause) => oauthError(`${operation}.decode`, cause)),
      ),
    orElse: (failed) =>
      Effect.fail(oauthError(operation, `Google request failed (${failed.status}).`)),
  })(response);

const identityRejection = (error: Jwt.JwtError) => {
  if (error._tag === "SchemaError") return malformed();
  const { reason } = error;
  switch (reason._tag) {
    case "InvalidToken":
    case "InvalidArgument":
    case "AlgorithmNotAllowed":
      return malformed();
    case "SignatureVerificationFailed":
      return rejected("Signature", "The identity token signature is invalid.");
    case "KeyNotFound":
    case "AmbiguousKey":
      return rejected("UnknownKey", "The identity token was not signed by Google.");
    case "ClaimValidationFailed":
      switch (reason.claim) {
        case "iss":
          return rejected("Issuer", "The identity token is not from Google.");
        case "aud":
          return rejected("Audience", "The identity token was issued for another application.");
        case "exp":
          return reason.reason === "expired"
            ? rejected("Expired", "The identity token has expired.")
            : malformed();
        default:
          return malformed();
      }
    case "InvalidKey":
    case "DecryptionFailed":
    case "KeySetUnavailable":
      return oauthError("keys.request", error);
  }
  return reason satisfies never;
};

export class GoogleOAuth extends Context.Service<
  GoogleOAuth,
  {
    readonly authorizationUrl: (input: {
      readonly state: string;
      readonly codeChallenge: string;
      readonly nonce: string;
    }) => URL;
    readonly exchangeCode: (input: {
      readonly code: string;
      readonly codeVerifier: string;
      readonly nonce: string;
    }) => Effect.Effect<GoogleProfile, GoogleOAuthError | GoogleIdentityRejected>;
  }
>()("@store/auth-worker/GoogleOAuth") {
  static readonly layer = (configuration: GoogleOAuthConfiguration) =>
    Layer.effect(
      GoogleOAuth,
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const signature = yield* Signature.Signature;
        const jwks = yield* Jwks.makeRemote({
          url: GOOGLE_KEYS_URL,
          timeToLive: KEY_SET_TTL,
          cooldown: KEY_SET_REFETCH_COOLDOWN,
          timeout: GOOGLE_REQUEST_TIMEOUT,
        }).pipe(Effect.mapError((cause) => oauthError("keys.request", cause)));
        const execute = (operation: string, request: HttpClientRequest.HttpClientRequest) =>
          client.execute(request).pipe(
            Effect.provideService(HttpClient.TracerDisabledWhen, constTrue),
            Effect.mapError((cause) => oauthError(operation, cause)),
          );

        const withinDeadline = (operation: string) =>
          Effect.timeoutOrElse({
            duration: GOOGLE_REQUEST_TIMEOUT,
            orElse: () => Effect.fail(oauthError(operation, "Google request timed out.")),
          });

        const exchangeForIdToken = Effect.fnUntraced(function* (
          request: HttpClientRequest.HttpClientRequest,
        ) {
          const response = yield* execute("exchangeCode.request", request);
          return yield* HttpClientResponse.matchStatus({
            400: Effect.fnUntraced(function* (refused) {
              const refusal = yield* HttpClientResponse.schemaBodyJson(GoogleTokenRefusal)(
                refused,
              ).pipe(Effect.mapError((cause) => oauthError("exchangeCode.refusal", cause)));
              return yield* refusal.error === "invalid_grant"
                ? rejected("Grant", "Google refused the authorization code.")
                : oauthError(
                    "exchangeCode.token",
                    `Google refused the request (${refusal.error}).`,
                  );
            }),
            orElse: (other) =>
              decodeOkJson("exchangeCode.token", GoogleTokenResponse, other).pipe(
                Effect.map((tokens) => tokens.id_token),
              ),
          })(response);
        }, withinDeadline("exchangeCode.request"));

        const verify = Effect.fnUntraced(function* (idToken: string, expectedNonce: string) {
          const { claims } = yield* Jwt.verifyWithKeySet(IdTokenClaims, idToken, {
            algorithms: ["RS256"],
            issuer: GOOGLE_ISSUERS,
            audience: configuration.clientId,
            requiredClaims: ["exp"],
          }).pipe(
            Effect.provideService(Jwks.Jwks, jwks),
            Effect.provideService(Signature.Signature, signature),
            Effect.mapError(identityRejection),
          );
          if (!isTrue(claims.email_verified)) {
            return yield* rejected("EmailUnverified", "Google did not verify this email address.");
          }
          if (
            claims.nonce === undefined ||
            !Mac.timingSafeEqual(
              textEncoder.encode(claims.nonce),
              textEncoder.encode(expectedNonce),
            )
          ) {
            return yield* rejected("Nonce", "The identity token belongs to another sign-in.");
          }
          const email = normalizedEmail(claims.email);
          return {
            providerAccountId: GoogleAccountId.make(claims.sub),
            email,
            ownsMailbox: GoogleLinking.ownsMailbox(claims.hd, email),
            name: claims.name ?? email.split("@")[0] ?? email,
            image: claims.picture ?? null,
          } satisfies GoogleProfile;
        });

        return GoogleOAuth.of({
          authorizationUrl: ({ state, codeChallenge, nonce }) => {
            const url = new URL(GOOGLE_AUTHORIZATION_URL);
            url.search = UrlParams.toString({
              client_id: configuration.clientId,
              redirect_uri: configuration.callbackUrl,
              response_type: "code",
              scope: "openid email profile",
              state,
              nonce,
              code_challenge: codeChallenge,
              code_challenge_method: "S256",
              prompt: "select_account",
            });
            return url;
          },
          exchangeCode: Effect.fn("GoogleOAuth.exchangeCode")(function* (input) {
            const request = HttpClientRequest.post(GOOGLE_TOKEN_URL).pipe(
              HttpClientRequest.bodyUrlParams({
                client_id: configuration.clientId,
                client_secret: Redacted.value(configuration.clientSecret),
                code: input.code,
                code_verifier: input.codeVerifier,
                grant_type: "authorization_code",
                redirect_uri: configuration.callbackUrl,
              }),
            );
            const idToken = yield* exchangeForIdToken(request);
            return yield* verify(idToken, input.nonce);
          }),
        });
      }),
    );
}
