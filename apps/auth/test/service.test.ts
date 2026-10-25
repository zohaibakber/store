import { describe, expect, it } from "@effect/vitest";
import { EmailAddress, IdentifyInput, OtpCode, type OtpChallengeId } from "@store/auth";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";

import { EphemeralStore } from "../src/ephemeral";
import {
  AuthApi,
  AuthTest,
  browser,
  count,
  forgingSigner,
  googleClaims,
  mintIdToken,
  native,
  PASSWORD,
  refreshWith,
  refusal,
  scenario,
  signUp,
  type IdTokenSigner,
} from "./harness";

const VERIFIER = "a".repeat(64);
const pkceChallenge = (verifier: string) =>
  Effect.promise(async () =>
    Base64Url.encode(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
    ),
  );

interface GoogleSignInOptions {
  readonly signer?: IdTokenSigner;
  readonly claimedNonce?: (issued: string) => string | undefined;
  readonly exchangeVerifier?: string;
}

const googleSignIn = Effect.fn("googleSignIn")(function* (
  profile: { readonly sub: string; readonly email: string },
  options: GoogleSignInOptions = {},
) {
  const auth = yield* AuthApi;
  const control = yield* AuthTest;
  const challenge = yield* pkceChallenge(VERIFIER);
  const authorization = yield* auth.beginGoogle({
    redirectUri: "https://app.example.com/callback",
    codeChallenge: challenge,
    client: browser,
  });
  const parameters = new URL(authorization.href).searchParams;
  const state = parameters.get("state");
  const nonce = parameters.get("nonce");
  if (!state || !nonce) {
    return yield* Effect.die(new Error("Google did not return a sign-in state."));
  }
  const claimedNonce = (options.claimedNonce ?? ((issued) => issued))(nonce);
  const claims = yield* googleClaims(profile);
  const idToken = yield* mintIdToken(
    claimedNonce === undefined ? claims : { ...claims, nonce: claimedNonce },
    options.signer,
  );
  yield* control.setGoogleIdToken(idToken);
  const callback = yield* auth.completeGoogle({ code: "google-authorization-code", state });
  return yield* auth.exchangeGoogle({
    code: callback.code,
    codeVerifier: options.exchangeVerifier ?? VERIFIER,
    client: browser,
  });
});

const identify = (email: string) =>
  AuthApi.use((auth) => auth.identify(IdentifyInput.make({ email: EmailAddress.make(email) })));

const otpSignIn = (challengeId: OtpChallengeId, code: string) => ({
  _tag: "Otp" as const,
  challengeId,
  code: OtpCode.make(code),
  client: native,
});

const sessions = (where = "1 = 1") =>
  count(`SELECT count(*) AS total FROM auth_session WHERE ${where}`);

const googleOnly = { sub: "google-sub-1", email: "google@example.com" };

describe("one-time codes", () => {
  it.effect("signs in with a delivered code", () =>
    Effect.gen(function* () {
      const auth = yield* AuthApi;
      yield* googleSignIn(googleOnly);
      const delivered = yield* identify(googleOnly.email);
      if (delivered._tag !== "Otp" || !delivered.developmentCode) {
        return yield* Effect.die(new Error("expected a code"));
      }
      expect(
        yield* count("SELECT count(*) AS total FROM auth_ephemeral_record WHERE kind = 'otp'"),
      ).toBe(1);
      const signedIn = yield* auth.authenticate(
        otpSignIn(delivered.challengeId, delivered.developmentCode),
      );
      expect(signedIn.workspace.user.email).toBe(googleOnly.email);
    }).pipe(scenario({ deliversOtp: true })),
  );

  it.effect("makes nothing redeemable while delivery is disabled", () =>
    Effect.gen(function* () {
      yield* googleSignIn(googleOnly);
      const issuedBefore = yield* sessions();
      const route = yield* identify(googleOnly.email);
      expect(route).toEqual({
        _tag: "Otp",
        email: googleOnly.email,
        challengeId: expect.any(String),
      });
      if (route._tag !== "Otp") return yield* Effect.die(new Error("expected the code route"));
      expect(yield* count("SELECT count(*) AS total FROM auth_ephemeral_record")).toBe(0);

      const store = yield* EphemeralStore;
      const planted = yield* store.issueOtp({
        email: EmailAddress.make(googleOnly.email),
        code: OtpCode.make("123456"),
        expiresAt: (yield* Clock.currentTimeMillis) + 60_000,
        metered: true,
      });
      if (planted._tag !== "Issued") return yield* Effect.die(new Error("expected a planted code"));
      for (const challengeId of [route.challengeId, planted.challengeId]) {
        const refused = yield* refusal(
          AuthApi.use((auth) => auth.authenticate(otpSignIn(challengeId, "123456"))),
        );
        expect(refused).toMatchObject({ status: 401, code: "INVALID_OTP" });
      }
      expect(yield* sessions()).toBe(issuedBefore);
    }).pipe(scenario()),
  );
});

describe("refresh rotation", () => {
  it.effect("gives one token exactly one successor and replays a lost response once", () =>
    Effect.gen(function* () {
      const first = yield* signUp("owner@example.com");
      const raced = yield* Effect.all(
        [refreshWith(first.refreshToken), refreshWith(first.refreshToken)],
        { concurrency: "unbounded" },
      );
      const second = raced.flatMap((result) => (result._tag === "Success" ? [result.success] : []));
      const lost = raced.flatMap((result) => (result._tag === "Failure" ? [result.failure] : []));
      expect(second).toHaveLength(1);
      expect(lost).toMatchObject([{ status: 401, code: "INVALID_REFRESH_TOKEN" }]);
      expect(yield* sessions()).toBe(2);

      const replayed = yield* refreshWith(first.refreshToken);
      if (replayed._tag !== "Success") {
        return yield* Effect.die(new Error("expected the lost response to be replayed"));
      }
      expect(replayed.success.refreshToken).not.toBe(second[0]?.refreshToken);
      expect(yield* sessions()).toBe(3);

      const again = yield* refreshWith(first.refreshToken);
      if (again._tag !== "Success") {
        return yield* Effect.die(new Error("expected a second lost response to be replayed"));
      }
      expect(yield* sessions()).toBe(4);

      const third = yield* refreshWith(again.success.refreshToken);
      expect(third._tag).toBe("Success");
      expect(yield* sessions()).toBe(5);
      expect(yield* sessions("revokedAt IS NULL")).toBe(1);
      expect(yield* count("SELECT count(DISTINCT familyId) AS total FROM auth_session")).toBe(1);
    }).pipe(scenario()),
  );

  it.effect("burns the family when a revoked token is presented after the reuse window", () =>
    Effect.gen(function* () {
      const first = yield* signUp("owner@example.com");
      const second = yield* refreshWith(first.refreshToken);
      if (second._tag !== "Success") return yield* Effect.die(new Error("expected a rotation"));
      yield* TestClock.adjust("2 minutes");

      const replay = yield* refreshWith(first.refreshToken);
      expect(replay).toMatchObject({
        _tag: "Failure",
        failure: { status: 401, code: "REFRESH_REUSE_DETECTED" },
      });

      const live = yield* refreshWith(second.success.refreshToken);
      expect(live).toMatchObject({ _tag: "Failure", failure: { status: 401 } });
      expect(yield* sessions("revokedAt IS NULL")).toBe(0);
    }).pipe(scenario()),
  );
});

describe("Google sign-in", () => {
  it.effect("refuses an identity token Google did not mint for us", () =>
    Effect.gen(function* () {
      const profile = { sub: "google-sub-1", email: "victim@example.com" };
      const failure = yield* refusal(googleSignIn(profile, { signer: forgingSigner }));
      expect(failure).toMatchObject({ status: 400, code: "INVALID_GOOGLE_IDENTITY" });
      expect(yield* sessions()).toBe(0);
      expect(yield* count("SELECT count(*) AS total FROM auth_user")).toBe(0);

      yield* googleSignIn(profile);
      expect(yield* sessions()).toBe(1);
    }).pipe(scenario()),
  );

  it.effect("refuses an identity token minted for another sign-in or carrying no nonce", () =>
    Effect.gen(function* () {
      const profile = { sub: "google-sub-1", email: "victim@example.com" };
      for (const claimedNonce of [() => "another-sign-in", () => undefined]) {
        const failure = yield* refusal(googleSignIn(profile, { claimedNonce }));
        expect(failure).toMatchObject({ status: 400, code: "INVALID_GOOGLE_IDENTITY" });
      }
      expect(yield* sessions()).toBe(0);
      expect(yield* count("SELECT count(*) AS total FROM auth_user")).toBe(0);
    }).pipe(scenario()),
  );

  it.effect("refuses an authorization code redeemed without its PKCE verifier", () =>
    Effect.gen(function* () {
      const profile = { sub: "google-sub-1", email: "victim@example.com" };
      const failure = yield* refusal(googleSignIn(profile, { exchangeVerifier: "b".repeat(64) }));
      expect(failure).toMatchObject({ status: 401, code: "INVALID_CODE_VERIFIER" });
      expect(yield* sessions()).toBe(0);
    }).pipe(scenario()),
  );

  it.effect("refuses an OAuth redirect nobody trusts", () =>
    Effect.gen(function* () {
      const failure = yield* refusal(
        AuthApi.use((auth) =>
          auth.beginGoogle({
            redirectUri: "https://phishing.example/callback",
            codeChallenge: "challenge",
            client: browser,
          }),
        ),
      );
      expect(failure).toMatchObject({ status: 400, code: "INVALID_REDIRECT" });
      expect(yield* count("SELECT count(*) AS total FROM auth_ephemeral_record")).toBe(0);
    }).pipe(scenario()),
  );

  it.effect("claims an unverified password account, dropping the password it never verified", () =>
    Effect.gen(function* () {
      yield* signUp("victim@example.com");
      expect(yield* sessions("revokedAt IS NULL")).toBe(1);

      yield* googleSignIn({ sub: "google-sub-new", email: "victim@example.com" });

      expect(
        yield* count(
          "SELECT count(*) AS total FROM auth_user WHERE passwordHash IS NULL AND emailVerifiedAt IS NOT NULL",
        ),
      ).toBe(1);
      expect(yield* sessions()).toBe(2);
      expect(yield* sessions("revokedAt IS NULL")).toBe(1);
      expect(yield* sessions("revokedAt IS NULL AND clientKind = 'Browser'")).toBe(1);
    }).pipe(scenario()),
  );

  it.effect("leaves a verified password account alone", () =>
    Effect.gen(function* () {
      yield* signUp("owner@example.com");
      const control = yield* AuthTest;
      control.d1.database.exec("UPDATE auth_user SET emailVerifiedAt = unixepoch()");

      const failure = yield* refusal(
        googleSignIn({ sub: "google-sub-new", email: "owner@example.com" }),
      );

      expect(failure).toMatchObject({ status: 409, code: "PASSWORD_ACCOUNT_EXISTS" });
      expect(
        yield* count("SELECT count(*) AS total FROM auth_user WHERE passwordHash IS NULL"),
      ).toBe(0);
      expect(yield* count("SELECT count(*) AS total FROM auth_oauth_account")).toBe(0);
    }).pipe(scenario()),
  );

  it.effect("does not move a Google identity that already belongs to somebody", () =>
    Effect.gen(function* () {
      yield* googleSignIn({ sub: "google-sub-new", email: "first@example.com" });
      yield* googleSignIn({ sub: "google-sub-2", email: "second@example.com" });

      const session = yield* googleSignIn({ sub: "google-sub-new", email: "second@example.com" });

      expect(session.workspace.user.email).toBe("first@example.com");
      expect(yield* count("SELECT count(*) AS total FROM auth_oauth_account")).toBe(2);
    }).pipe(scenario()),
  );
});

describe("rate limits", () => {
  it.effect("caps password guesses before the sixth try", () =>
    Effect.gen(function* () {
      yield* signUp("owner@example.com");
      const signIn = (password: string) =>
        refusal(
          AuthApi.use((auth) =>
            auth.authenticate({
              _tag: "Password",
              email: EmailAddress.make("owner@example.com"),
              password: Redacted.make(password),
              client: native,
            }),
          ),
        );

      for (let attempt = 0; attempt < 5; attempt++) {
        expect(yield* signIn("not the password")).toMatchObject({
          status: 401,
          code: "INVALID_CREDENTIALS",
        });
      }
      expect(yield* signIn(Redacted.value(PASSWORD))).toMatchObject({
        status: 429,
        code: "RATE_LIMITED",
      });
    }).pipe(scenario()),
  );

  it.effect("refuses a correct credential while the limiter cannot answer", () =>
    Effect.gen(function* () {
      const auth = yield* AuthApi;
      const control = yield* AuthTest;
      yield* signUp("owner@example.com");
      yield* control.setLimiterAvailable(false);

      const attempts = yield* Effect.all([
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
      ]);

      expect(attempts.map((attempt) => attempt._tag)).toEqual(["Failure", "Failure", "Failure"]);
      expect(yield* sessions()).toBe(1);
      expect(yield* count("SELECT count(*) AS total FROM auth_user")).toBe(1);
    }).pipe(scenario()),
  );
});
