import {
  type AuthorizationCode,
  type BeginGoogleInput,
  type ExchangeGoogleIdTokenInput,
  type ExchangeGoogleInput,
} from "@store/auth";
import { isTrustedRedirect } from "@store/auth/security";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AUTHORIZATION_TTL_MS, AuthCrypto, OAUTH_STATE_TTL_MS } from "./crypto";
import { EphemeralStore } from "./ephemeral";
import { AuthRefusal } from "./failures";
import { GoogleOAuth, type GoogleProfile } from "./google";
import { AuthLimiter } from "./limits";
import { AuthRepository, type UserRecord } from "./repository";
import { Sessions } from "./session-ops";
import { AuthSettings } from "./settings";

export interface GoogleCallback {
  readonly redirectUri: string;
  readonly code: AuthorizationCode;
}

export class GoogleIdentity extends Context.Service<GoogleIdentity>()(
  "@store/auth-worker/GoogleIdentity",
  {
    make: Effect.gen(function* () {
      const repository = yield* AuthRepository;
      const ephemeral = yield* EphemeralStore;
      const google = yield* GoogleOAuth;
      const sessions = yield* Sessions;
      const limiter = yield* AuthLimiter;
      const crypto = yield* AuthCrypto;
      const { trustedRedirects } = yield* AuthSettings;

      const linkGoogleUser = Effect.fn("Auth.Google.linkGoogleUser")(function* (
        profile: GoogleProfile,
      ) {
        const now = yield* Clock.currentTimeMillis;
        const linked = yield* repository.findUserByGoogleId(profile.providerAccountId);
        if (linked) return linked;
        const existing = yield* repository.findUserByEmail(profile.email);
        if (!existing) return yield* repository.createGoogleUser(profile);
        if (existing.passwordHash && existing.emailVerified) {
          return yield* new AuthRefusal({ reason: "PasswordAccountExists" });
        }
        const claimed = existing.passwordHash
          ? yield* repository.claimUnverifiedPasswordUser({
              userId: existing.id,
              providerAccountId: profile.providerAccountId,
              image: profile.image,
              now,
            })
          : yield* repository.attachGoogleAccount({
              userId: existing.id,
              providerAccountId: profile.providerAccountId,
            });
        if (!claimed) {
          return yield* new AuthRefusal({ reason: "GoogleAccountLinked" });
        }
        return { ...existing, passwordHash: null, emailVerified: true } satisfies UserRecord;
      });

      const beginGoogle = Effect.fn("Auth.Google.beginGoogle")(function* (input: BeginGoogleInput) {
        const now = yield* Clock.currentTimeMillis;
        if (!isTrustedRedirect(input.redirectUri, trustedRedirects)) {
          return yield* new AuthRefusal({ reason: "InvalidRedirect" });
        }
        const googleCodeVerifier = yield* crypto.randomToken(32);
        const googleNonce = yield* crypto.randomToken(16);
        const state = yield* ephemeral.createOAuthState({
          redirectUri: input.redirectUri,
          codeChallenge: input.codeChallenge,
          client: input.client,
          googleCodeVerifier,
          googleNonce,
          expiresAt: now + OAUTH_STATE_TTL_MS,
        });
        return google.authorizationUrl({
          state,
          codeChallenge: yield* crypto.pkceChallenge(googleCodeVerifier),
          nonce: googleNonce,
        });
      });

      const completeGoogle = Effect.fn("Auth.Google.completeGoogle")(function* (input: {
        readonly code: string;
        readonly state: string;
      }) {
        const now = yield* Clock.currentTimeMillis;
        const state = yield* ephemeral.consumeOAuthState(input.state, now);
        if (!state) {
          return yield* new AuthRefusal({ reason: "InvalidOAuthState" });
        }
        const profile = yield* google
          .exchangeCode({
            code: input.code,
            codeVerifier: state.googleCodeVerifier,
            nonce: state.googleNonce,
          })
          .pipe(
            Effect.catchTag("Auth.GoogleIdentityRejected", () =>
              Effect.fail(new AuthRefusal({ reason: "GoogleCodeUnverified" })),
            ),
          );
        const user = yield* linkGoogleUser(profile);
        const code = yield* ephemeral.createAuthorizationGrant({
          userId: user.id,
          codeChallenge: state.codeChallenge,
          client: state.client,
          expiresAt: now + AUTHORIZATION_TTL_MS,
        });
        return { redirectUri: state.redirectUri, code };
      });

      const exchangeGoogle = Effect.fn("Auth.Google.exchangeGoogle")(function* (
        input: ExchangeGoogleInput,
      ) {
        const now = yield* Clock.currentTimeMillis;
        const grant = yield* ephemeral.consumeAuthorizationGrant(input.code, now);
        if (!grant) {
          return yield* new AuthRefusal({ reason: "InvalidAuthorizationCode" });
        }
        const challenge = yield* crypto.pkceChallenge(input.codeVerifier);
        if (!(yield* crypto.matches(challenge, grant.codeChallenge))) {
          return yield* new AuthRefusal({ reason: "InvalidCodeVerifier" });
        }
        if (input.client._tag !== grant.client._tag) {
          return yield* new AuthRefusal({ reason: "InvalidOAuthClient" });
        }
        const user = yield* repository.findUserById(grant.userId);
        if (!user) {
          return yield* new AuthRefusal({ reason: "AccountNotFound" });
        }
        return yield* sessions.issueSession(user, grant.client, `oauth-${input.code}`);
      });

      const exchangeGoogleIdToken = Effect.fn("Auth.Google.exchangeGoogleIdToken")(function* (
        input: ExchangeGoogleIdTokenInput,
      ) {
        const profile = yield* google.verifyIdToken(input.idToken).pipe(
          Effect.tapErrorTag("Auth.GoogleOAuthError", (failure) =>
            Effect.logError("auth.infrastructure").pipe(
              Effect.annotateLogs({
                tag: failure._tag,
                operation: failure.operation,
                message: failure.message,
              }),
            ),
          ),
          Effect.mapError(() => new AuthRefusal({ reason: "InvalidGoogleIdentity" })),
        );
        yield* limiter.admit(
          "tenPerMinute",
          `google-identity:${profile.providerAccountId}`,
          "request",
        );
        const user = yield* linkGoogleUser(profile);
        return yield* sessions.issueSession(user, input.client);
      });

      return { beginGoogle, completeGoogle, exchangeGoogle, exchangeGoogleIdToken };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
