import { EmailAddress, type EmailAddress as EmailAddressType } from "@store/auth";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

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
  /** Client IDs of the native apps, whose ID tokens carry their own audience. */
  readonly nativeClientIds?: ReadonlyArray<string>;
  readonly fetch?: typeof globalThis.fetch;
}

const oauthError = (operation: string, cause: unknown) =>
  new GoogleOAuthError({ operation, message: String(cause), cause });

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
        url.searchParams.set("client_id", configuration.clientId);
        url.searchParams.set("redirect_uri", configuration.callbackUrl);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("scope", "openid email profile");
        url.searchParams.set("state", state);
        url.searchParams.set("prompt", "select_account");
        return url;
      },
      exchangeCode: Effect.fn("GoogleOAuth.exchangeCode")(function* (code) {
        const tokenResponse = yield* Effect.tryPromise({
          try: (signal) =>
            fetch("https://oauth2.googleapis.com/token", {
              method: "POST",
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_id: configuration.clientId,
                client_secret: configuration.clientSecret,
                code,
                grant_type: "authorization_code",
                redirect_uri: configuration.callbackUrl,
              }),
              signal,
            }),
          catch: (cause) => oauthError("exchangeCode.request", cause),
        });
        if (!tokenResponse.ok) {
          return yield* oauthError(
            "exchangeCode.response",
            `Google token exchange failed (${tokenResponse.status}).`,
          );
        }
        const tokenPayload = yield* Effect.tryPromise({
          try: () => tokenResponse.json(),
          catch: (cause) => oauthError("exchangeCode.tokenJson", cause),
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(GoogleTokenResponse)),
          Effect.mapError((cause) => oauthError("exchangeCode.tokenDecode", cause)),
        );
        const profileResponse = yield* Effect.tryPromise({
          try: (signal) =>
            fetch("https://openidconnect.googleapis.com/v1/userinfo", {
              headers: { authorization: `Bearer ${tokenPayload.access_token}` },
              signal,
            }),
          catch: (cause) => oauthError("exchangeCode.profileRequest", cause),
        });
        if (!profileResponse.ok) {
          return yield* oauthError(
            "exchangeCode.profileResponse",
            `Google profile lookup failed (${profileResponse.status}).`,
          );
        }
        const profile = yield* Effect.tryPromise({
          try: () => profileResponse.json(),
          catch: (cause) => oauthError("exchangeCode.profileJson", cause),
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(GoogleUserInfo)),
          Effect.mapError((cause) => oauthError("exchangeCode.profileDecode", cause)),
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
      /**
       * Google's `tokeninfo` endpoint checks the signature and expiry for us;
       * the audience and issuer are ours to check, otherwise an ID token minted
       * for any other app would be accepted here.
       */
      verifyIdToken: Effect.fn("GoogleOAuth.verifyIdToken")(function* (idToken) {
        const now = yield* Clock.currentTimeMillis;
        const response = yield* Effect.tryPromise({
          try: (signal) =>
            fetch(
              `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
              { signal },
            ),
          catch: (cause) => oauthError("verifyIdToken.request", cause),
        });
        if (!response.ok) {
          return yield* oauthError(
            "verifyIdToken.response",
            `Google rejected the identity token (${response.status}).`,
          );
        }
        const info = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: (cause) => oauthError("verifyIdToken.json", cause),
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(GoogleTokenInfo)),
          Effect.mapError((cause) => oauthError("verifyIdToken.decode", cause)),
        );
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
