import { EmailAddress, GoogleIdToken, IdentifyInput, Password, RefreshInput } from "@store/auth";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { AuthService } from "../src/service";
import { harness, seedOrganization, seedSession, seedUser, type Harness } from "./harness";

const googleProfile = {
  providerAccountId: "google-sub-1",
  email: EmailAddress.make("google@example.com"),
  name: "Google User",
  image: null,
};

const withAccounts = () => {
  const instance = harness({ googleProfile });
  const passwordUser = seedUser(instance.store, {
    id: "password-user",
    email: "password@example.com",
    name: "Password User",
  });
  seedOrganization(instance.store, {
    id: "organization-1",
    name: "My Store",
    members: [{ userId: passwordUser.id, role: "owner" }],
  });
  const googleUser = seedUser(instance.store, {
    id: "google-user",
    email: "google@example.com",
    name: "Google User",
    password: false,
    emailVerified: true,
  });
  seedOrganization(instance.store, {
    id: "organization-2",
    name: "Google Store",
    members: [{ userId: googleUser.id, role: "owner" }],
  });
  instance.store.googleIdentities.push({
    providerAccountId: "google-sub-1",
    userId: googleUser.id,
  });
  return { instance, passwordUser, googleUser };
};

const run = <A, E>(
  instance: Harness,
  use: (auth: ReturnType<typeof AuthService.of>) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const auth = yield* AuthService;
      return yield* use(auth);
    }).pipe(Effect.provide(instance.layer)),
  );

describe("AuthService", () => {
  it("routes identifiers by their credential", async () => {
    const { instance } = withAccounts();
    const identify = (email: string) =>
      run(instance, (auth) =>
        auth.identify(IdentifyInput.make({ email: EmailAddress.make(email) })),
      );

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
    const { instance, passwordUser } = withAccounts();
    const tokens = await run(instance, (auth) =>
      auth.authenticate({
        _tag: "Password",
        email: passwordUser.email,
        password: Password.make("valid-password"),
        client: { _tag: "Native", deviceName: "Test device" },
      }),
    );

    expect(tokens.accessToken).toBeDefined();
    expect(instance.issued.at(-1)).toMatchObject({
      subject: "password-user",
      activeOrganizationId: "organization-1",
      organizationName: "My Store",
      role: "owner",
    });
  });

  it("signs in the Google account behind a verified identity token", async () => {
    const { instance } = withAccounts();
    const tokens = await run(instance, (auth) =>
      auth.exchangeGoogleIdToken({
        idToken: GoogleIdToken.make("valid-id-token"),
        client: { _tag: "Native", deviceName: "Test device" },
      }),
    );

    expect(tokens.accessToken).toBeDefined();
    expect(instance.issued.at(-1)).toMatchObject({
      subject: "google-user",
      email: "google@example.com",
    });
  });

  it("refuses an identity token Google did not mint for us", async () => {
    const { instance } = withAccounts();
    const failure = await run(instance, (auth) =>
      Effect.flip(
        auth.exchangeGoogleIdToken({
          idToken: GoogleIdToken.make("someone-elses-id-token"),
          client: { _tag: "Native", deviceName: "Test device" },
        }),
      ),
    );

    expect(failure).toMatchObject({ status: 401, code: "INVALID_GOOGLE_IDENTITY" });
    expect(instance.issued).toHaveLength(0);
  });

  it("refuses an OAuth redirect nobody trusts", async () => {
    const { instance } = withAccounts();
    const failure = await run(instance, (auth) =>
      Effect.flip(
        auth.beginGoogle({
          redirectUri: "https://phishing.example/callback",
          codeChallenge: "challenge",
          client: { _tag: "Browser" },
        }),
      ),
    );

    expect(failure).toMatchObject({ status: 400, code: "INVALID_REDIRECT" });
  });

  it("accepts the desktop deep link, which shares only its scheme", async () => {
    const { instance } = withAccounts();
    const url = await run(instance, (auth) =>
      auth.beginGoogle({
        redirectUri: "com.tabaaq.desktop://auth/callback",
        codeChallenge: "challenge",
        client: { _tag: "Native", deviceName: "Test device" },
      }),
    );

    expect(url.searchParams.get("state")).toBe("oauth-state");
  });
});

describe("refresh rotation", () => {
  it("does not kill the rotated session when the previous token is presented immediately", async () => {
    const { instance, passwordUser } = withAccounts();
    const first = await run(instance, (auth) =>
      auth.authenticate({
        _tag: "Password",
        email: passwordUser.email,
        password: Password.make("valid-password"),
        client: { _tag: "Native", deviceName: "Test device" },
      }),
    );
    const second = await run(instance, (auth) =>
      auth.refresh(RefreshInput.make({ refreshToken: first.refreshToken })),
    );

    const replay = await run(instance, (auth) =>
      Effect.flip(auth.refresh(RefreshInput.make({ refreshToken: first.refreshToken }))),
    );
    expect(replay).toMatchObject({ status: 401, code: "INVALID_REFRESH_TOKEN" });

    const third = await run(instance, (auth) =>
      auth.refresh(RefreshInput.make({ refreshToken: second.refreshToken })),
    );
    expect(third.refreshToken).toBeDefined();
    expect(instance.store.sessions.filter((session) => session.revokedAt === null)).toHaveLength(1);
  });

  it("burns the family when a revoked token is presented after the grace window", async () => {
    const { instance, passwordUser } = withAccounts();
    const first = await run(instance, (auth) =>
      auth.authenticate({
        _tag: "Password",
        email: passwordUser.email,
        password: Password.make("valid-password"),
        client: { _tag: "Native", deviceName: "Test device" },
      }),
    );
    const second = await run(instance, (auth) =>
      auth.refresh(RefreshInput.make({ refreshToken: first.refreshToken })),
    );
    const previous = instance.store.sessions.find((session) => session.replacedBySessionId !== null);
    expect(previous?.revokedAt).not.toBeNull();
    if (previous) previous.revokedAt = Date.now() - 60_000;

    const replay = await run(instance, (auth) =>
      Effect.flip(auth.refresh(RefreshInput.make({ refreshToken: first.refreshToken }))),
    );
    expect(replay).toMatchObject({ status: 401, code: "REFRESH_REUSE_DETECTED" });

    const live = await run(instance, (auth) =>
      Effect.flip(auth.refresh(RefreshInput.make({ refreshToken: second.refreshToken }))),
    );
    expect(live).toMatchObject({ status: 401 });
    expect(instance.store.sessions.every((session) => session.revokedAt !== null)).toBe(true);
  });
});

describe("Google account linking", () => {
  const linkingHarness = (email: string) => {
    const instance = harness({
      googleProfile: {
        providerAccountId: "google-sub-new",
        email: EmailAddress.make(email),
        name: "Real Owner",
        image: "https://example.com/avatar.png",
      },
    });
    return instance;
  };

  it("claims an unverified password account, dropping the password it never verified", async () => {
    const instance = linkingHarness("victim@example.com");
    const victim = seedUser(instance.store, {
      id: "victim",
      email: "victim@example.com",
      name: "Squatter",
    });
    const organizationId = seedOrganization(instance.store, {
      id: "organization-1",
      name: "Victim Store",
      members: [{ userId: victim.id, role: "owner" }],
    });
    seedSession(instance.store, { id: "session-squatter", userId: victim.id, organizationId });

    await run(instance, (auth) =>
      auth.exchangeGoogleIdToken({
        idToken: GoogleIdToken.make("valid-id-token"),
        client: { _tag: "Browser" },
      }),
    );

    const claimed = instance.store.users.find((user) => user.id === victim.id);
    expect(claimed?.passwordHash).toBeNull();
    expect(claimed?.emailVerified).toBe(true);
    expect(instance.store.sessions.find((s) => s.id === "session-squatter")?.revokedAt).not.toBe(
      null,
    );
  });

  it("leaves a verified password account alone", async () => {
    const instance = linkingHarness("owner@example.com");
    const owner = seedUser(instance.store, {
      id: "owner",
      email: "owner@example.com",
      emailVerified: true,
    });
    seedOrganization(instance.store, {
      id: "organization-1",
      name: "Owner Store",
      members: [{ userId: owner.id, role: "owner" }],
    });

    const failure = await run(instance, (auth) =>
      Effect.flip(
        auth.exchangeGoogleIdToken({
          idToken: GoogleIdToken.make("valid-id-token"),
          client: { _tag: "Browser" },
        }),
      ),
    );

    expect(failure).toMatchObject({ status: 409, code: "PASSWORD_ACCOUNT_EXISTS" });
    expect(instance.store.users.find((user) => user.id === owner.id)?.passwordHash).not.toBeNull();
  });

  it("does not move a Google identity that already belongs to somebody", async () => {
    const instance = linkingHarness("second@example.com");
    const first = seedUser(instance.store, {
      id: "first",
      email: "first@example.com",
      password: false,
      emailVerified: true,
    });
    seedOrganization(instance.store, {
      id: "organization-1",
      name: "First Store",
      members: [{ userId: first.id, role: "owner" }],
    });
    instance.store.googleIdentities.push({
      providerAccountId: "google-sub-new",
      userId: first.id,
    });
    const second = seedUser(instance.store, {
      id: "second",
      email: "second@example.com",
      password: false,
    });
    seedOrganization(instance.store, {
      id: "organization-2",
      name: "Second Store",
      members: [{ userId: second.id, role: "owner" }],
    });

    await run(instance, (auth) =>
      auth.exchangeGoogleIdToken({
        idToken: GoogleIdToken.make("valid-id-token"),
        client: { _tag: "Browser" },
      }),
    );

    expect(instance.issued.at(-1)).toMatchObject({ subject: "first" });
    expect(instance.store.googleIdentities).toHaveLength(1);
  });
});
