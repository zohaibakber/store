import {
  AccessToken,
  AccessTokenService,
  AuthorizationCode,
  EmailAddress,
  EmailProvider,
  IdentifyInput,
  OrganizationId,
  OtpChallengeId,
  Password,
  PasswordHash,
  PasswordHasher,
  UserId,
  type IssueAccessTokenInput,
} from "@store/auth";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { beforeEach, describe, expect, it } from "vitest";

import { EphemeralStore } from "../src/ephemeral";
import { GoogleOAuth } from "../src/google";
import { AuthRepository, type AuthRepositoryApi, type UserRecord } from "../src/repository";
import { AuthService, authServiceLayer } from "../src/service";

const passwordHash = PasswordHash.make("pbkdf2-sha256$310000$c2FsdA$aGFzaA");
const passwordUser: UserRecord = {
  id: UserId.make("password-user"),
  email: EmailAddress.make("password@example.com"),
  name: "Password User",
  image: null,
  passwordHash,
};
const googleUser: UserRecord = {
  id: UserId.make("google-user"),
  email: EmailAddress.make("google@example.com"),
  name: "Google User",
  image: null,
  passwordHash: null,
};
const membership = {
  organizationId: OrganizationId.make("organization-1"),
  organizationName: "My Store",
  organizationSlug: "my-store",
  role: "owner" as const,
};

let issuedClaims: IssueAccessTokenInput | null;

const repository: AuthRepositoryApi = {
  findUserByEmail: (email) =>
    Effect.succeed(
      email === passwordUser.email ? passwordUser : email === googleUser.email ? googleUser : null,
    ),
  findUserById: (userId) =>
    Effect.succeed(
      userId === passwordUser.id ? passwordUser : userId === googleUser.id ? googleUser : null,
    ),
  findUserByGoogleId: () => Effect.succeed(null),
  createPasswordUser: () => Effect.die("not used"),
  createGoogleUser: () => Effect.die("not used"),
  attachGoogleAccount: () => Effect.die("not used"),
  membershipForUser: () => Effect.succeed(membership),
  membershipsForUser: () => Effect.succeed([membership]),
  createSession: () => Effect.void,
  findSession: () => Effect.succeed(null),
  rotateSession: () => Effect.succeed(false),
  revokeSession: () => Effect.void,
  revokeFamily: () => Effect.void,
  revokeUser: () => Effect.void,
};

const Dependencies = Layer.mergeAll(
  Layer.succeed(AuthRepository, AuthRepository.of(repository)),
  Layer.succeed(
    EphemeralStore,
    EphemeralStore.of({
      createOtp: () => Effect.succeed(OtpChallengeId.make("challenge-1")),
      consumeOtp: () => Effect.succeed(null),
      createOAuthState: () => Effect.succeed("oauth-state"),
      consumeOAuthState: () => Effect.succeed(null),
      createAuthorizationGrant: () => Effect.succeed(AuthorizationCode.make("authorization-code")),
      consumeAuthorizationGrant: () => Effect.succeed(null),
      allow: () => Effect.succeed(true),
    }),
  ),
  Layer.succeed(
    PasswordHasher,
    PasswordHasher.of({
      hash: () => Effect.succeed(passwordHash),
      verify: () => Effect.succeed(true),
    }),
  ),
  Layer.succeed(
    AccessTokenService,
    AccessTokenService.of({
      issue: (input) => {
        issuedClaims = input;
        return Effect.succeed({
          token: AccessToken.make("access-token"),
          expiresAt: Date.now() + 300_000,
        });
      },
      verify: () => Effect.die("not used"),
    }),
  ),
  Layer.succeed(
    EmailProvider,
    EmailProvider.of({
      sendOtp: () => Effect.void,
    }),
  ),
  Layer.succeed(
    GoogleOAuth,
    GoogleOAuth.of({
      authorizationUrl: (state) => new URL(`https://accounts.example/authorize?state=${state}`),
      exchangeCode: () => Effect.die("not used"),
    }),
  ),
);

const Live = authServiceLayer({
  developmentOtp: true,
  trustedRedirects: ["https://app.example.com"],
  refreshTokenPepper: "refresh-pepper",
}).pipe(Layer.provide(Dependencies));

const identify = (email: string) =>
  Effect.gen(function* () {
    const auth = yield* AuthService;
    return yield* auth.identify(IdentifyInput.make({ email: EmailAddress.make(email) }));
  }).pipe(Effect.provide(Live), Effect.runPromise);

describe("AuthService", () => {
  beforeEach(() => {
    issuedClaims = null;
  });

  it("routes identifiers by their credential", async () => {
    await expect(identify("password@example.com")).resolves.toEqual({
      _tag: "Password",
      email: "password@example.com",
    });
    await expect(identify("google@example.com")).resolves.toMatchObject({
      _tag: "Otp",
      email: "google@example.com",
      challengeId: "challenge-1",
    });
    await expect(identify("new@example.com")).resolves.toEqual({
      _tag: "Registration",
      email: "new@example.com",
    });
  });

  it("issues sessions from the user's organization membership", async () => {
    const tokens = await Effect.runPromise(
      Effect.gen(function* () {
        const auth = yield* AuthService;
        return yield* auth.authenticate({
          _tag: "Password",
          email: passwordUser.email,
          password: Password.make("valid-password"),
          client: { _tag: "Native", deviceName: "Test device" },
        });
      }).pipe(Effect.provide(Live)),
    );

    expect(tokens.accessToken).toBe("access-token");
    expect(issuedClaims).toMatchObject({
      subject: "password-user",
      activeOrganizationId: "organization-1",
      organizationName: "My Store",
      organizationSlug: "my-store",
      role: "owner",
    });
  });
});
