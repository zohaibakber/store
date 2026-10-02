import {
  EmailAddress,
  GoogleIdToken,
  IdentifyInput,
  OtpCode,
  Password,
  type OtpChallengeId,
} from "@store/auth";
import { RateLimitError } from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { EphemeralStore, ephemeralStoreLayer } from "../src/ephemeral";
import {
  browser,
  count,
  EPHEMERAL_PEPPER,
  failing,
  harness,
  native,
  PASSWORD,
  refreshWith,
  run,
  signUp,
  forgingSigner,
  googleClaims,
  mintIdToken,
  type Api,
  type Harness,
  type IdTokenSigner,
} from "./harness";

const googleSignIn =
  (profile: { sub: string; email: string }, signer?: IdTokenSigner) => (auth: Api) =>
    Effect.promise(() => mintIdToken(googleClaims(profile), signer)).pipe(
      Effect.flatMap((idToken) =>
        auth.exchangeGoogleIdToken({ idToken: GoogleIdToken.make(idToken), client: browser }),
      ),
    );

const identify = (instance: Harness, email: string) =>
  run(instance, (auth) => auth.identify(IdentifyInput.make({ email: EmailAddress.make(email) })));

const otpSignIn = (challengeId: OtpChallengeId, code: string) => ({
  _tag: "Otp" as const,
  challengeId,
  code: OtpCode.make(code),
  client: native,
});

const sessions = (instance: Harness, where = "1 = 1") =>
  count(instance, `SELECT count(*) AS total FROM auth_session WHERE ${where}`);

describe("one-time codes", () => {
  const googleOnly = { sub: "google-sub-1", email: "google@example.com" };

  it("signs in with a delivered code and makes nothing redeemable while delivery is disabled", async () => {
    const delivering = harness({ deliversOtp: true });
    await run(delivering, googleSignIn(googleOnly));
    const delivered = await identify(delivering, googleOnly.email);
    if (delivered._tag !== "Otp" || !delivered.developmentCode) throw new Error("expected a code");
    expect(count(delivering, "SELECT count(*) AS total FROM auth_ephemeral_record")).toBe(1);
    const signedIn = await run(delivering, (auth) =>
      auth.authenticate(otpSignIn(delivered.challengeId, delivered.developmentCode ?? "")),
    );
    expect(signedIn.workspace.user.email).toBe(googleOnly.email);

    const disabled = harness({ deliversOtp: false });
    await run(disabled, googleSignIn(googleOnly));
    const issuedBefore = sessions(disabled);
    const route = await identify(disabled, googleOnly.email);
    expect(route).toEqual({
      _tag: "Otp",
      email: googleOnly.email,
      challengeId: expect.any(String),
    });
    if (route._tag !== "Otp") throw new Error("expected the code route");
    expect(count(disabled, "SELECT count(*) AS total FROM auth_ephemeral_record")).toBe(0);

    const planted = await Effect.runPromise(
      EphemeralStore.use((store) =>
        store.createOtp({
          email: EmailAddress.make(googleOnly.email),
          code: OtpCode.make("123456"),
          expiresAt: Date.now() + 60_000,
        }),
      ).pipe(Effect.provide(ephemeralStoreLayer(disabled.d1, EPHEMERAL_PEPPER))),
    );
    for (const challengeId of [route.challengeId, planted]) {
      const refused = await failing(disabled, (auth) =>
        auth.authenticate(otpSignIn(challengeId, "123456")),
      );
      expect(refused).toMatchObject({ status: 401, code: "INVALID_OTP" });
    }
    expect(sessions(disabled)).toBe(issuedBefore);
  });
});

describe("refresh rotation", () => {
  it("gives one token exactly one successor and survives an immediate replay", async () => {
    const instance = harness();
    const first = await signUp(instance, "owner@example.com");
    const raced = await Promise.all([
      refreshWith(instance, first.refreshToken),
      refreshWith(instance, first.refreshToken),
    ]);
    const second = raced.flatMap((result) => (result._tag === "Success" ? [result.success] : []));
    const lost = raced.flatMap((result) => (result._tag === "Failure" ? [result.failure] : []));
    expect(second).toHaveLength(1);
    expect(lost).toMatchObject([{ status: 401, code: "INVALID_REFRESH_TOKEN" }]);
    expect(sessions(instance)).toBe(2);

    const replay = await refreshWith(instance, first.refreshToken);
    expect(replay).toMatchObject({
      _tag: "Failure",
      failure: { status: 401, code: "INVALID_REFRESH_TOKEN" },
    });

    const third = await refreshWith(instance, second[0]?.refreshToken);
    expect(third._tag).toBe("Success");
    expect(sessions(instance)).toBe(3);
    expect(sessions(instance, "revokedAt IS NULL")).toBe(1);
    expect(count(instance, "SELECT count(DISTINCT familyId) AS total FROM auth_session")).toBe(1);
  });

  it("burns the family when a revoked token is presented after the grace window", async () => {
    const instance = harness();
    const first = await signUp(instance, "owner@example.com");
    const second = await refreshWith(instance, first.refreshToken);
    if (second._tag !== "Success") throw new Error("expected a rotation");
    instance.d1.database.exec(
      "UPDATE auth_session SET revokedAt = revokedAt - 60 WHERE replacedBySessionId IS NOT NULL",
    );

    const replay = await refreshWith(instance, first.refreshToken);
    expect(replay).toMatchObject({
      _tag: "Failure",
      failure: { status: 401, code: "REFRESH_REUSE_DETECTED" },
    });

    const live = await refreshWith(instance, second.success.refreshToken);
    expect(live).toMatchObject({ _tag: "Failure", failure: { status: 401 } });
    expect(sessions(instance, "revokedAt IS NULL")).toBe(0);
  });
});

describe("Google sign-in", () => {
  it("refuses an identity token Google did not mint for us", async () => {
    const instance = harness();
    const profile = { sub: "google-sub-1", email: "victim@example.com" };
    const failure = await failing(instance, googleSignIn(profile, forgingSigner));
    expect(failure).toMatchObject({ status: 401, code: "INVALID_GOOGLE_IDENTITY" });
    expect(sessions(instance)).toBe(0);
    expect(count(instance, "SELECT count(*) AS total FROM auth_user")).toBe(0);

    await run(instance, googleSignIn(profile));
    expect(sessions(instance)).toBe(1);
  });

  it("refuses an OAuth redirect nobody trusts", async () => {
    const instance = harness();
    const failure = await failing(instance, (auth) =>
      auth.beginGoogle({
        redirectUri: "https://phishing.example/callback",
        codeChallenge: "challenge",
        client: browser,
      }),
    );
    expect(failure).toMatchObject({ status: 400, code: "INVALID_REDIRECT" });
    expect(count(instance, "SELECT count(*) AS total FROM auth_ephemeral_record")).toBe(0);
  });

  it("claims an unverified password account, dropping the password it never verified", async () => {
    const instance = harness();
    await signUp(instance, "victim@example.com");
    expect(sessions(instance, "revokedAt IS NULL")).toBe(1);

    await run(instance, googleSignIn({ sub: "google-sub-new", email: "victim@example.com" }));

    expect(
      count(
        instance,
        "SELECT count(*) AS total FROM auth_user WHERE passwordHash IS NULL AND emailVerifiedAt IS NOT NULL",
      ),
    ).toBe(1);
    expect(sessions(instance)).toBe(2);
    expect(sessions(instance, "revokedAt IS NULL")).toBe(1);
    expect(sessions(instance, "revokedAt IS NULL AND clientKind = 'Browser'")).toBe(1);
  });

  it("leaves a verified password account alone", async () => {
    const instance = harness();
    await signUp(instance, "owner@example.com");
    instance.d1.database.exec("UPDATE auth_user SET emailVerifiedAt = unixepoch()");

    const failure = await failing(
      instance,
      googleSignIn({ sub: "google-sub-new", email: "owner@example.com" }),
    );

    expect(failure).toMatchObject({ status: 409, code: "PASSWORD_ACCOUNT_EXISTS" });
    expect(
      count(instance, "SELECT count(*) AS total FROM auth_user WHERE passwordHash IS NULL"),
    ).toBe(0);
    expect(count(instance, "SELECT count(*) AS total FROM auth_oauth_account")).toBe(0);
  });

  it("does not move a Google identity that already belongs to somebody", async () => {
    const instance = harness();
    await run(instance, googleSignIn({ sub: "google-sub-new", email: "first@example.com" }));
    await run(instance, googleSignIn({ sub: "google-sub-2", email: "second@example.com" }));

    const session = await run(
      instance,
      googleSignIn({ sub: "google-sub-new", email: "second@example.com" }),
    );

    expect(session.workspace.user.email).toBe("first@example.com");
    expect(count(instance, "SELECT count(*) AS total FROM auth_oauth_account")).toBe(2);
  });
});

describe("rate limits", () => {
  it("caps password guesses before the sixth try", async () => {
    const instance = harness();
    await signUp(instance, "owner@example.com");
    const signIn = (password: string) =>
      failing(instance, (auth) =>
        auth.authenticate({
          _tag: "Password",
          email: EmailAddress.make("owner@example.com"),
          password: Password.make(password),
          client: native,
        }),
      );

    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(signIn("not the password")).resolves.toMatchObject({
        status: 401,
        code: "INVALID_CREDENTIALS",
      });
    }
    await expect(signIn(PASSWORD)).resolves.toMatchObject({ status: 429, code: "RATE_LIMITED" });
  });

  it("refuses a correct credential while the limiter cannot answer", async () => {
    const limiter = { available: true };
    const limit = () =>
      limiter.available
        ? Effect.succeed({ success: true })
        : Effect.fail(new RateLimitError({ message: "limiter unavailable", cause: "binding" }));
    const instance = harness({ limits: { tenPerMinute: limit, fivePerMinute: limit } });
    await signUp(instance, "owner@example.com");
    limiter.available = false;

    const attempts = await run(instance, (auth) =>
      Effect.all([
        Effect.exit(
          auth.authenticate({
            _tag: "Password",
            email: EmailAddress.make("owner@example.com"),
            password: PASSWORD,
            client: native,
          }),
        ),
        Effect.exit(
          auth.authenticate({
            _tag: "RegisterPassword",
            email: EmailAddress.make("second@example.com"),
            name: "Second",
            password: PASSWORD,
            client: native,
          }),
        ),
        Effect.exit(
          auth.identify(IdentifyInput.make({ email: EmailAddress.make("owner@example.com") })),
        ),
      ]),
    );

    expect(attempts.map((attempt) => attempt._tag)).toEqual(["Failure", "Failure", "Failure"]);
    expect(sessions(instance)).toBe(1);
    expect(count(instance, "SELECT count(*) AS total FROM auth_user")).toBe(1);
  });
});
