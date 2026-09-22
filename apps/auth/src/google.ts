import { EmailAddress, type EmailAddress as EmailAddressType } from "@store/auth";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as UrlParams from "effect/unstable/http/UrlParams";

const GoogleTokenResponse = Schema.Struct({
  access_token: Schema.String,
});

const GoogleUserInfo = Schema.Struct({
  sub: Schema.String,
  email: EmailAddress,
  email_verified: Schema.Boolean,
  name: Schema.String,
  picture: Schema.optionalKey(Schema.String),
});

/**
 * `tokeninfo` answers with JSON strings for the numeric and boolean claims,
 * and has answered with real numbers and booleans in the past. Accept both.
 */
const GoogleTokenInfo = Schema.Struct({
  iss: Schema.String,
  aud: Schema.String,
  sub: Schema.String,
  exp: Schema.Union([Schema.Finite, Schema.FiniteFromString]),
  email: EmailAddress,
  email_verified: Schema.Union([Schema.Boolean, Schema.Literals(["true", "false"])]),
  name: Schema.optionalKey(Schema.String),
  picture: Schema.optionalKey(Schema.String),
});

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

const isTrue = (value: boolean | "true" | "false") => value === true || value === "true";

export interface GoogleProfile {
  readonly providerAccountId: string;
  readonly email: EmailAddressType;
  readonly name: string;
  readonly image: string | null;
}

export class GoogleOAuthError extends Schema.TaggedError<GoogleOAuthError>()(
  "Auth.GoogleOAuthError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export interface GoogleOAuthApi {
  readonly authorizationUrl: (state: string) => URL;
  readonly exchangeCode: (code: string) => Effect.Effect<GoogleProfile, GoogleOAuthError>;
  readonly verifyIdToken: (idToken: string) => Effect.Effect<GoogleProfile, GoogleOAuthError>;
}

export class GoogleOAuth extends Context.Service<GoogleOAuth, GoogleOAuthApi>()(
  "@store/auth-worker/GoogleOAuth",
) {}

export interface GoogleOAuthConfiguration {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly callbackUrl: string;
  readonly nativeClientIds?: ReadonlyArray<string>;
  readonly fetch?: typeof globalThis.fetch;
}

const oauthError = (operation: string, cause: unknown) =>
  new GoogleOAuthError({ operation, message: String(cause), cause });

const provideFetch = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  fetch: typeof globalThis.fetch,
): Effect.Effect<A, E> =>
  // SAFETY: FetchHttpClient.layer + Fetch binding satisfy HttpClient; the residual env is empty.
  effect.pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, fetch),
  ) as Effect.Effect<A, E>;

const decodeOkJson = <A>(
  operation: string,
  schema: Schema.ConstraintDecoder<A>,
  response: HttpClientResponse.HttpClientResponse,
) =>
  HttpClientResponse.filterStatusOk(response).pipe(
    Effect.mapError((cause) =>
      oauthError(
        operation,
        `Google request failed (${"response" in cause && cause.response ? cause.response.status : "transport"}).`,
      ),
    ),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
    Effect.mapError((cause) => oauthError(`${operation}.decode`, cause)),
  );

export const googleOAuthLayer = (configuration: GoogleOAuthConfiguration) => {
  const fetch = configuration.fetch ?? globalThis.fetch;
  const audiences = new Set(
    [configuration.clientId, ...(configuration.nativeClientIds ?? [])].filter(
      (value) => value.trim().length > 0,
    ),
  );
  return Layer.succeed(
    GoogleOAuth,
    GoogleOAuth.of({
      authorizationUrl: (state) => {
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.search = UrlParams.toString({
          client_id: configuration.clientId,
          redirect_uri: configuration.callbackUrl,
          response_type: "code",
          scope: "openid email profile",
          state,
          prompt: "select_account",
        });
        return url;
      },
      exchangeCode: Effect.fn("GoogleOAuth.exchangeCode")(function* (code) {
        const tokenRequest = HttpClientRequest.post("https://oauth2.googleapis.com/token").pipe(
          HttpClientRequest.bodyUrlParams({
            client_id: configuration.clientId,
            client_secret: configuration.clientSecret,
            code,
            grant_type: "authorization_code",
            redirect_uri: configuration.callbackUrl,
          }),
        );
        const tokenResponse = yield* provideFetch(
          HttpClient.execute(tokenRequest).pipe(
            Effect.mapError((cause) => oauthError("exchangeCode.request", cause)),
          ),
          fetch,
        );
        const tokenPayload = yield* decodeOkJson(
          "exchangeCode.token",
          GoogleTokenResponse,
          tokenResponse,
        );
        const profileRequest = HttpClientRequest.get(
          "https://openidconnect.googleapis.com/v1/userinfo",
        ).pipe(HttpClientRequest.bearerToken(tokenPayload.access_token));
        const profileResponse = yield* provideFetch(
          HttpClient.execute(profileRequest).pipe(
            Effect.mapError((cause) => oauthError("exchangeCode.profileRequest", cause)),
          ),
          fetch,
        );
        const profile = yield* decodeOkJson(
          "exchangeCode.profile",
          GoogleUserInfo,
          profileResponse,
        );
        if (!profile.email_verified) {
          return yield* oauthError(
            "exchangeCode.profile",
            "Google did not verify this email address.",
          );
        }
        return {
          providerAccountId: profile.sub,
          email: profile.email,
          name: profile.name,
          image: profile.picture ?? null,
        } satisfies GoogleProfile;
      }),
      verifyIdToken: Effect.fn("GoogleOAuth.verifyIdToken")(function* (idToken) {
        const now = yield* Clock.currentTimeMillis;
        const request = HttpClientRequest.get("https://oauth2.googleapis.com/tokeninfo").pipe(
          HttpClientRequest.setUrlParams({ id_token: idToken }),
        );
        const response = yield* provideFetch(
          HttpClient.execute(request).pipe(
            Effect.mapError((cause) => oauthError("verifyIdToken.request", cause)),
          ),
          fetch,
        );
        const info = yield* decodeOkJson("verifyIdToken", GoogleTokenInfo, response);
        if (!GOOGLE_ISSUERS.includes(info.iss)) {
          return yield* oauthError(
            "verifyIdToken.issuer",
            "The identity token is not from Google.",
          );
        }
        if (!audiences.has(info.aud)) {
          return yield* oauthError(
            "verifyIdToken.audience",
            "The identity token was issued for another application.",
          );
        }
        if (info.exp * 1_000 <= now) {
          return yield* oauthError("verifyIdToken.expiry", "The identity token has expired.");
        }
        if (!isTrue(info.email_verified)) {
          return yield* oauthError(
            "verifyIdToken.email",
            "Google did not verify this email address.",
          );
        }
        return {
          providerAccountId: info.sub,
          email: info.email,
          name: info.name ?? info.email.split("@")[0] ?? info.email,
          image: info.picture ?? null,
        } satisfies GoogleProfile;
      }),
    }),
  );
};
