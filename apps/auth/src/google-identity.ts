import {
  type AuthorizationCode,
  type BeginGoogleInput,
  type ExchangeGoogleInput,
} from "@store/auth";
import { isTrustedRedirect } from "@store/auth/security";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { AuthCrypto } from "./crypto";
import { EphemeralStore } from "./ephemeral";
import { AuthRefusal } from "./failures";
import { GoogleOAuth, type GoogleProfile } from "./google";
import * as GoogleLinking from "./google-linking";
import type { OAuthState } from "./identifiers";
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
      const crypto = yield* AuthCrypto;
      const { trustedRedirects } = yield* AuthSettings;

      const linkGoogleUser = Effect.fn("GoogleIdentity.linkGoogleUser")(function* (
        profile: GoogleProfile,
      ) {
        const now = yield* Clock.currentTimeMillis;
        const linked = yield* repository.findUserByGoogleId(profile.providerAccountId);
        const existing = linked ? null : yield* repository.findUserByEmail(profile.email);
        const link = yield* Effect.fromResult(
          GoogleLinking.decideGoogleLink(
            Option.fromNullishOr(linked),
            Option.fromNullishOr(existing),
            profile.ownsMailbox,
          ),
        );
        switch (link._tag) {
          case "Use":
            return link.user;
          case "Create":
            return yield* repository.createGoogleUser(profile);
          case "Claim":
          case "Attach": {
            const joined =
              link._tag === "Claim"
                ? yield* repository.claimUnverifiedPasswordUser({
                    userId: link.user.id,
                    providerAccountId: profile.providerAccountId,
                    image: profile.image,
                    now,
                  })
                : yield* repository.attachGoogleAccount({
                    userId: link.user.id,
                    providerAccountId: profile.providerAccountId,
                  });
            if (!joined) {
              return yield* new AuthRefusal({ reason: "GoogleAccountLinked" });
            }
            return { ...link.user, passwordHash: null, emailVerified: true } satisfies UserRecord;
          }
          default: {
            const _exhaustive: never = link;
            return _exhaustive;
          }
        }
      });

      const beginGoogle = Effect.fn("GoogleIdentity.beginGoogle")(function* (
        input: BeginGoogleInput,
      ) {
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
          expiresAt: now + GoogleLinking.OAUTH_STATE_TTL_MS,
        });
        return google.authorizationUrl({
          state,
          codeChallenge: yield* crypto.pkceChallenge(googleCodeVerifier),
          nonce: googleNonce,
        });
      });

      const completeGoogle = Effect.fn("GoogleIdentity.completeGoogle")(function* (input: {
        readonly code: string;
        readonly state: OAuthState;
      }) {
        const now = yield* Clock.currentTimeMillis;
        const state = yield* ephemeral.consumeOAuthState(input.state);
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
            Effect.catchTag("GoogleIdentityRejected", () =>
              Effect.fail(new AuthRefusal({ reason: "GoogleCodeUnverified" })),
            ),
          );
        const user = yield* linkGoogleUser(profile);
        const code = yield* ephemeral.createAuthorizationGrant({
          userId: user.id,
          codeChallenge: state.codeChallenge,
          client: state.client,
          expiresAt: now + GoogleLinking.AUTHORIZATION_TTL_MS,
        });
        return { redirectUri: state.redirectUri, code };
      });

      const exchangeGoogle = Effect.fn("GoogleIdentity.exchangeGoogle")(function* (
        input: ExchangeGoogleInput,
      ) {
        const grant = yield* ephemeral.consumeAuthorizationGrant(input.code);
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

      return { beginGoogle, completeGoogle, exchangeGoogle };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
