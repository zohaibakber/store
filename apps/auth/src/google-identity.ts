import {
  AuthorizationCode,
  isTrustedRedirect,
  type BeginGoogleInput,
  type ExchangeGoogleIdTokenInput,
  type ExchangeGoogleInput,
} from "@store/auth";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import { AUTHORIZATION_TTL_MS, OAUTH_STATE_TTL_MS, safeEqual, sha256 } from "./crypto";
import type { EphemeralStoreApi } from "./ephemeral";
import { authError } from "./errors";
import type { GoogleOAuthApi, GoogleProfile } from "./google";
import type { AuthRepositoryApi, UserRecord } from "./repository";
import type { SessionOps } from "./session-ops";

export interface GoogleIdentityConfiguration {
  readonly trustedRedirects: ReadonlyArray<string>;
}

export interface GoogleCallback {
  readonly redirectUri: string;
  readonly code: typeof AuthorizationCode.Type;
}

export const makeGoogleIdentityOps = (
  repository: AuthRepositoryApi,
  ephemeral: EphemeralStoreApi,
  google: GoogleOAuthApi,
  sessions: Pick<SessionOps, "issueSession">,
  configuration: GoogleIdentityConfiguration,
) => {
  /**
   * One Google identity, one Tabaaq user, however the identity arrived.
   *
   * The address arrives verified by Google, so it outranks a password
   * account nobody has ever verified: signing up with someone else's
   * address must not leave an attacker holding a credential on the real
   * owner's account, so the claim strips the password and revokes every
   * session opened with it. An account whose address *is* verified keeps
   * its password, and linking Google to it needs a deliberate act from
   * inside that session rather than an implicit merge here.
   */
  const linkGoogleUser = Effect.fn("Auth.Google.linkGoogleUser")(function* (
    profile: GoogleProfile,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const linked = yield* repository.findUserByGoogleId(profile.providerAccountId);
    if (linked) return linked;
    const existing = yield* repository.findUserByEmail(profile.email);
    if (!existing) return yield* repository.createGoogleUser(profile);
    if (existing.passwordHash && existing.emailVerified) {
      return yield* authError(
        409,
        "PASSWORD_ACCOUNT_EXISTS",
        "Sign in with your password, then connect Google from settings.",
      );
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
      return yield* authError(
        409,
        "GOOGLE_ACCOUNT_LINKED",
        "This Google account is already connected to another Tabaaq account.",
      );
    }
    return { ...existing, passwordHash: null, emailVerified: true } satisfies UserRecord;
  });

  const beginGoogle = Effect.fn("Auth.Google.beginGoogle")(function* (input: BeginGoogleInput) {
    const now = yield* Clock.currentTimeMillis;
    if (!isTrustedRedirect(input.redirectUri, configuration.trustedRedirects)) {
      return yield* authError(400, "INVALID_REDIRECT", "The OAuth redirect is not allowed.");
    }
    const state = yield* ephemeral.createOAuthState({
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      client: input.client,
      expiresAt: now + OAUTH_STATE_TTL_MS,
    });
    return google.authorizationUrl(state);
  });

  const completeGoogle = Effect.fn("Auth.Google.completeGoogle")(function* (input: {
    readonly code: string;
    readonly state: string;
  }) {
    const now = yield* Clock.currentTimeMillis;
    const state = yield* ephemeral.consumeOAuthState(input.state, now);
    if (!state) {
      return yield* authError(
        400,
        "INVALID_OAUTH_STATE",
        "The Google sign-in request has expired.",
      );
    }
    const profile = yield* google.exchangeCode(input.code);
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
      return yield* authError(
        401,
        "INVALID_AUTHORIZATION_CODE",
        "The Google authorization has expired.",
      );
    }
    const challenge = yield* sha256(input.codeVerifier);
    if (!safeEqual(challenge, grant.codeChallenge)) {
      return yield* authError(
        401,
        "INVALID_CODE_VERIFIER",
        "The Google authorization could not be verified.",
      );
    }
    if (input.client._tag !== grant.client._tag) {
      return yield* authError(
        401,
        "INVALID_OAUTH_CLIENT",
        "The Google authorization client does not match.",
      );
    }
    const user = yield* repository.findUserById(grant.userId);
    if (!user) {
      return yield* authError(401, "ACCOUNT_NOT_FOUND", "The account no longer exists.");
    }
    return yield* sessions.issueSession(user, grant.client, `oauth-${input.code}`);
  });

  /**
   * Native clients present Google's own account picker, so there is no
   * redirect to protect with PKCE: the ID token itself is the proof.
   */
  const exchangeGoogleIdToken = Effect.fn("Auth.Google.exchangeGoogleIdToken")(function* (
    input: ExchangeGoogleIdTokenInput,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const profile = yield* google
      .verifyIdToken(input.idToken)
      .pipe(
        Effect.mapError(() =>
          authError(401, "INVALID_GOOGLE_IDENTITY", "Google sign-in could not be verified."),
        ),
      );
    const allowed = yield* repository.allowRateLimit({
      key: `google-identity:${profile.providerAccountId}`,
      limit: 10,
      windowSeconds: 60,
      now,
    });
    if (!allowed) {
      return yield* authError(429, "RATE_LIMITED", "Wait before trying again.");
    }
    const user = yield* linkGoogleUser(profile);
    return yield* sessions.issueSession(user, input.client);
  });

  return { beginGoogle, completeGoogle, exchangeGoogle, exchangeGoogleIdToken };
};

export type GoogleIdentityOps = ReturnType<typeof makeGoogleIdentityOps>;
