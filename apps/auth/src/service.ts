import {
  AccessTokenService,
  AuthorizationCode,
  EmailAddress,
  EmailProvider,
  LoginRoute,
  OtpCode,
  PasswordHasher,
  RefreshToken,
  SessionId,
  TokenSet,
  normalizeEmail,
  type AuthClientKind,
  type BeginGoogleInput,
  type ExchangeGoogleIdTokenInput,
  type ExchangeGoogleInput,
  type IdentifyInput,
  type LoginCommand,
  type LoginRoute as LoginRouteType,
  type RefreshInput,
  type SignOutInput,
  type TokenSet as TokenSetType,
} from "@store/auth";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { EphemeralStore } from "./ephemeral";
import { GoogleOAuth, type GoogleProfile } from "./google";
import { AuthRepository, type UserRecord } from "./repository";

const textEncoder = new TextEncoder();
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const OTP_TTL_MS = 10 * 60 * 1_000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1_000;
const AUTHORIZATION_TTL_MS = 5 * 60 * 1_000;

export class AuthError extends Schema.TaggedError<AuthError>()("Auth.AuthError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
}) {}

export interface GoogleCallback {
  readonly redirectUri: string;
  readonly code: typeof AuthorizationCode.Type;
}

export interface AuthServiceApi {
  readonly identify: (input: IdentifyInput) => Effect.Effect<LoginRouteType, AuthError>;
  readonly authenticate: (command: LoginCommand) => Effect.Effect<TokenSetType, AuthError>;
  readonly beginGoogle: (input: BeginGoogleInput) => Effect.Effect<URL, AuthError>;
  readonly completeGoogle: (input: {
    readonly code: string;
    readonly state: string;
  }) => Effect.Effect<GoogleCallback, AuthError>;
  readonly exchangeGoogle: (input: ExchangeGoogleInput) => Effect.Effect<TokenSetType, AuthError>;
  readonly exchangeGoogleIdToken: (
    input: ExchangeGoogleIdTokenInput,
  ) => Effect.Effect<TokenSetType, AuthError>;
  readonly refresh: (input: RefreshInput) => Effect.Effect<TokenSetType, AuthError>;
  readonly signOut: (input: SignOutInput) => Effect.Effect<void, AuthError>;
}

export class AuthService extends Context.Service<AuthService, AuthServiceApi>()(
  "@store/auth-worker/AuthService",
) {}

export interface AuthServiceConfiguration {
  readonly developmentOtp: boolean;
  readonly trustedRedirects: ReadonlyArray<string>;
  readonly refreshTokenPepper: string;
}

const authError = (status: number, code: string, message: string) =>
  new AuthError({ status, code, message });

const infrastructureError = (cause: unknown) =>
  cause instanceof AuthError
    ? cause
    : authError(503, "AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.");

const randomSecret = (bytes: number) => {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
};

const sha256 = (value: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", textEncoder.encode(value)).then((buffer) => {
      let binary = "";
      for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
    }),
  );

const safeEqual = (left: string, right: string) => {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
};

const generateOtp = () => {
  const maximum = 4_294_000_000;
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values);
  while ((values[0] ?? 0) >= maximum);
  return OtpCode.make(String((values[0] ?? 0) % 1_000_000).padStart(6, "0"));
};

const redirectAllowed = (redirectUri: string, trusted: ReadonlyArray<string>) => {
  try {
    const url = new URL(redirectUri);
    return trusted.some((entry) => {
      if (entry.includes("://")) {
        try {
          const trustedUrl = new URL(entry);
          return trustedUrl.protocol === url.protocol && trustedUrl.host === url.host;
        } catch {
          return redirectUri.startsWith(entry);
        }
      }
      return redirectUri.startsWith(entry);
    });
  } catch {
    return false;
  }
};

const parseRefreshToken = (token: string) =>
  Effect.gen(function* () {
    const separator = token.indexOf(".");
    if (separator <= 0 || separator === token.length - 1) {
      return yield* authError(401, "INVALID_REFRESH_TOKEN", "The session has expired.");
    }
    const sessionId = yield* Schema.decodeUnknownEffect(SessionId)(token.slice(0, separator)).pipe(
      Effect.mapError(() => authError(401, "INVALID_REFRESH_TOKEN", "The session has expired.")),
    );
    return { sessionId, secret: token.slice(separator + 1) };
  });

export const authServiceLayer = (configuration: AuthServiceConfiguration) =>
  Layer.effect(
    AuthService,
    Effect.gen(function* () {
      const repository = yield* AuthRepository;
      const ephemeral = yield* EphemeralStore;
      const passwords = yield* PasswordHasher;
      const accessTokens = yield* AccessTokenService;
      const email = yield* EmailProvider;
      const google = yield* GoogleOAuth;

      const issueSession = Effect.fn("AuthService.issueSession")(function* (
        user: UserRecord,
        client: AuthClientKind,
        replayKey?: string,
      ) {
        const membership = yield* repository.membershipForUser(user.id);
        const sessionId = SessionId.make(replayKey ?? crypto.randomUUID());
        const familyId = crypto.randomUUID();
        const refreshSecret = randomSecret(32);
        const refreshTokenHash = yield* sha256(
          `${configuration.refreshTokenPepper}:${refreshSecret}`,
        );
        const refreshExpiresAt = Date.now() + REFRESH_TTL_MS;
        yield* repository.createSession({
          id: sessionId,
          familyId,
          userId: user.id,
          activeOrganizationId: membership.organizationId,
          refreshTokenHash,
          client,
          expiresAt: refreshExpiresAt,
        });
        const access = yield* accessTokens.issue({
          subject: user.id,
          sessionId,
          activeOrganizationId: membership.organizationId,
          organizationName: membership.organizationName,
          organizationSlug: membership.organizationSlug,
          role: membership.role,
          email: user.email,
          name: user.name,
          image: user.image,
        });
        return TokenSet.make({
          accessToken: access.token,
          accessExpiresAt: access.expiresAt,
          refreshToken: RefreshToken.make(`${sessionId}.${refreshSecret}`),
          refreshExpiresAt,
        });
      });

      const identify = Effect.fn("AuthService.identify")(function* (input: IdentifyInput) {
        const normalized = yield* Schema.decodeUnknownEffect(EmailAddress)(
          normalizeEmail(input.email),
        ).pipe(Effect.mapError(() => authError(400, "INVALID_EMAIL", "Enter a valid email.")));
        const allowed = yield* ephemeral.allow({
          key: `identify:${normalized}`,
          limit: 10,
          windowSeconds: 60,
          now: Date.now(),
        });
        if (!allowed) {
          return yield* authError(429, "RATE_LIMITED", "Wait before trying again.");
        }
        const user = yield* repository.findUserByEmail(normalized);
        if (!user) return LoginRoute.make({ _tag: "Registration", email: normalized });
        if (user.passwordHash) return LoginRoute.make({ _tag: "Password", email: normalized });
        const code = generateOtp();
        const expiresAt = Date.now() + OTP_TTL_MS;
        const challengeId = yield* ephemeral.createOtp({
          email: normalized,
          code,
          expiresAt,
        });
        yield* email.sendOtp({ email: normalized, code, expiresAt });
        if (configuration.developmentOtp) {
          return LoginRoute.make({
            _tag: "Otp",
            email: normalized,
            challengeId,
            developmentCode: code,
          });
        }
        return LoginRoute.make({ _tag: "Otp", email: normalized, challengeId });
      });

      const authenticate = Effect.fn("AuthService.authenticate")(function* (command: LoginCommand) {
        switch (command._tag) {
          case "Password": {
            const emailAddress = EmailAddress.make(normalizeEmail(command.email));
            const allowed = yield* ephemeral.allow({
              key: `password:${emailAddress}`,
              limit: 5,
              windowSeconds: 300,
              now: Date.now(),
            });
            if (!allowed) {
              return yield* authError(429, "RATE_LIMITED", "Wait before trying again.");
            }
            const user = yield* repository.findUserByEmail(emailAddress);
            if (!user?.passwordHash) {
              return yield* authError(
                401,
                "INVALID_CREDENTIALS",
                "The email or password is incorrect.",
              );
            }
            const verified = yield* passwords.verify(command.password, user.passwordHash);
            if (!verified) {
              return yield* authError(
                401,
                "INVALID_CREDENTIALS",
                "The email or password is incorrect.",
              );
            }
            return yield* issueSession(user, command.client);
          }
          case "Otp": {
            const allowed = yield* ephemeral.allow({
              key: `otp-attempt:${command.challengeId}`,
              limit: 5,
              windowSeconds: OTP_TTL_MS / 1_000,
              now: Date.now(),
            });
            if (!allowed) {
              return yield* authError(429, "RATE_LIMITED", "Wait before trying another code.");
            }
            const emailAddress = yield* ephemeral.consumeOtp({
              challengeId: command.challengeId,
              code: command.code,
              now: Date.now(),
            });
            if (!emailAddress) {
              return yield* authError(401, "INVALID_OTP", "The code is invalid or has expired.");
            }
            const user = yield* repository.findUserByEmail(emailAddress);
            if (!user || user.passwordHash) {
              return yield* authError(401, "INVALID_OTP", "The code is invalid or has expired.");
            }
            return yield* issueSession(user, command.client, `otp-${command.challengeId}`);
          }
          case "RegisterPassword": {
            const emailAddress = EmailAddress.make(normalizeEmail(command.email));
            const existing = yield* repository.findUserByEmail(emailAddress);
            if (existing) {
              return yield* authError(
                409,
                "ACCOUNT_EXISTS",
                "An account already exists for this email.",
              );
            }
            const passwordHash = yield* passwords.hash(command.password);
            const user = yield* repository.createPasswordUser({
              email: emailAddress,
              name: command.name,
              passwordHash,
            });
            return yield* issueSession(user, command.client);
          }
          default: {
            const _exhaustive: never = command;
            return _exhaustive;
          }
        }
      });

      /** One Google identity, one Tabaaq user, however the identity arrived. */
      const linkGoogleUser = Effect.fn("AuthService.linkGoogleUser")(function* (
        profile: GoogleProfile,
      ) {
        const linked = yield* repository.findUserByGoogleId(profile.providerAccountId);
        if (linked) return linked;
        const existing = yield* repository.findUserByEmail(profile.email);
        if (existing) {
          yield* repository.attachGoogleAccount({
            userId: existing.id,
            providerAccountId: profile.providerAccountId,
          });
          return existing;
        }
        return yield* repository.createGoogleUser(profile);
      });

      const beginGoogle = Effect.fn("AuthService.beginGoogle")(function* (input: BeginGoogleInput) {
        if (!redirectAllowed(input.redirectUri, configuration.trustedRedirects)) {
          return yield* authError(400, "INVALID_REDIRECT", "The OAuth redirect is not allowed.");
        }
        const state = yield* ephemeral.createOAuthState({
          redirectUri: input.redirectUri,
          codeChallenge: input.codeChallenge,
          client: input.client,
          expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
        });
        return google.authorizationUrl(state);
      });

      const completeGoogle = Effect.fn("AuthService.completeGoogle")(function* (input: {
        readonly code: string;
        readonly state: string;
      }) {
        const state = yield* ephemeral.consumeOAuthState(input.state, Date.now());
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
          expiresAt: Date.now() + AUTHORIZATION_TTL_MS,
        });
        return { redirectUri: state.redirectUri, code };
      });

      const exchangeGoogle = Effect.fn("AuthService.exchangeGoogle")(function* (
        input: ExchangeGoogleInput,
      ) {
        const grant = yield* ephemeral.consumeAuthorizationGrant(input.code, Date.now());
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
        return yield* issueSession(user, grant.client, `oauth-${input.code}`);
      });

      /**
       * Native clients present Google's own account picker, so there is no
       * redirect to protect with PKCE: the ID token itself is the proof.
       */
      const exchangeGoogleIdToken = Effect.fn("AuthService.exchangeGoogleIdToken")(function* (
        input: ExchangeGoogleIdTokenInput,
      ) {
        const profile = yield* google
          .verifyIdToken(input.idToken)
          .pipe(
            Effect.mapError(() =>
              authError(401, "INVALID_GOOGLE_IDENTITY", "Google sign-in could not be verified."),
            ),
          );
        const allowed = yield* ephemeral.allow({
          key: `google-identity:${profile.providerAccountId}`,
          limit: 10,
          windowSeconds: 60,
          now: Date.now(),
        });
        if (!allowed) {
          return yield* authError(429, "RATE_LIMITED", "Wait before trying again.");
        }
        const user = yield* linkGoogleUser(profile);
        return yield* issueSession(user, input.client);
      });

      const refresh = Effect.fn("AuthService.refresh")(function* (input: RefreshInput) {
        if (!input.refreshToken) {
          return yield* authError(401, "REFRESH_REQUIRED", "The session has expired.");
        }
        const parsed = yield* parseRefreshToken(input.refreshToken);
        const current = yield* repository.findSession(parsed.sessionId);
        if (!current) {
          return yield* authError(401, "INVALID_REFRESH_TOKEN", "The session has expired.");
        }
        const actualHash = yield* sha256(`${configuration.refreshTokenPepper}:${parsed.secret}`);
        if (!safeEqual(actualHash, current.refreshTokenHash)) {
          return yield* authError(401, "INVALID_REFRESH_TOKEN", "The session has expired.");
        }
        if (current.revokedAt !== null) {
          yield* repository.revokeFamily(current.familyId, Date.now());
          return yield* authError(
            401,
            "REFRESH_REUSE_DETECTED",
            "This session was revoked. Sign in again.",
          );
        }
        if (current.expiresAt <= Date.now()) {
          return yield* authError(401, "REFRESH_EXPIRED", "The session has expired.");
        }
        const user = yield* repository.findUserById(current.userId);
        if (!user) {
          return yield* authError(401, "ACCOUNT_NOT_FOUND", "The account no longer exists.");
        }
        const membership = yield* repository.membershipForUser(user.id);
        const nextId = SessionId.make(crypto.randomUUID());
        const nextSecret = randomSecret(32);
        const nextHash = yield* sha256(`${configuration.refreshTokenPepper}:${nextSecret}`);
        const refreshExpiresAt = Date.now() + REFRESH_TTL_MS;
        const rotated = yield* repository.rotateSession({
          currentId: current.id,
          now: Date.now(),
          replacement: {
            id: nextId,
            familyId: current.familyId,
            userId: current.userId,
            activeOrganizationId: membership.organizationId,
            refreshTokenHash: nextHash,
            client:
              current.clientKind === "Browser"
                ? { _tag: "Browser" }
                : { _tag: "Native", deviceName: current.deviceName ?? "Native client" },
            expiresAt: refreshExpiresAt,
          },
        });
        if (!rotated) {
          yield* repository.revokeFamily(current.familyId, Date.now());
          return yield* authError(
            401,
            "REFRESH_REUSE_DETECTED",
            "This session was revoked. Sign in again.",
          );
        }
        const access = yield* accessTokens.issue({
          subject: user.id,
          sessionId: nextId,
          activeOrganizationId: membership.organizationId,
          organizationName: membership.organizationName,
          organizationSlug: membership.organizationSlug,
          role: membership.role,
          email: user.email,
          name: user.name,
          image: user.image,
        });
        return TokenSet.make({
          accessToken: access.token,
          accessExpiresAt: access.expiresAt,
          refreshToken: RefreshToken.make(`${nextId}.${nextSecret}`),
          refreshExpiresAt,
        });
      });

      const signOut = Effect.fn("AuthService.signOut")(function* (input: SignOutInput) {
        if (!input.refreshToken) return;
        const parsed = yield* parseRefreshToken(input.refreshToken);
        const session = yield* repository.findSession(parsed.sessionId);
        if (!session) return;
        const actualHash = yield* sha256(`${configuration.refreshTokenPepper}:${parsed.secret}`);
        if (!safeEqual(actualHash, session.refreshTokenHash)) return;
        if (input.everywhere) yield* repository.revokeUser(session.userId, Date.now());
        else yield* repository.revokeSession(session.id, Date.now());
      });

      const handle = <A, E>(effect: Effect.Effect<A, E>) =>
        effect.pipe(Effect.mapError(infrastructureError));

      return AuthService.of({
        identify: (input) => handle(identify(input)),
        authenticate: (command) => handle(authenticate(command)),
        beginGoogle: (input) => handle(beginGoogle(input)),
        completeGoogle: (input) => handle(completeGoogle(input)),
        exchangeGoogle: (input) => handle(exchangeGoogle(input)),
        exchangeGoogleIdToken: (input) => handle(exchangeGoogleIdToken(input)),
        refresh: (input) => handle(refresh(input)),
        signOut: (input) => handle(signOut(input)),
      });
    }),
  );
