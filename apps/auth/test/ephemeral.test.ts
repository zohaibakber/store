import { describe, expect, it } from "@effect/vitest";
import { AuthorizationCode, EmailAddress, OtpCode, UserId, type AuthClientKind } from "@store/auth";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import { EphemeralStore } from "../src/ephemeral";
import { AuthTest, count, ephemeralIsolate, native, scenario } from "./harness";

const OTP_TTL_MS = 60_000;

const issueOtp = (code: OtpCode) =>
  Effect.gen(function* () {
    const store = yield* EphemeralStore;
    const now = yield* Clock.currentTimeMillis;
    return yield* store.issueOtp({ email, code, expiresAt: now + OTP_TTL_MS, metered: true });
  });

const issuedChallenge = (code: OtpCode) =>
  Effect.flatMap(issueOtp(code), (issue) =>
    issue._tag === "Issued" ? Effect.succeed(issue.challengeId) : Effect.die(issue),
  );

const rowCount = count(
  "SELECT count(*) AS total FROM auth_ephemeral_record WHERE kind <> 'otp-issuance'",
);

const email = EmailAddress.make("owner@example.com");
const code = OtpCode.make("123456");

describe("ephemeral store on D1", () => {
  it.effect("burns the OTP challenge on the fifth wrong code and not before", () =>
    Effect.gen(function* () {
      const store = yield* EphemeralStore;
      const wrong = OtpCode.make("654321");
      const attemptsBeforeTheRightCode = Effect.fn("attemptsBeforeTheRightCode")(function* (
        wrongGuesses: number,
      ) {
        const challengeId = yield* issuedChallenge(code);
        for (let guess = 0; guess < wrongGuesses; guess += 1) {
          expect(yield* store.consumeOtp({ challengeId, code: wrong })).toBeNull();
        }
        const result = yield* store.consumeOtp({ challengeId, code });
        yield* TestClock.adjust("31 seconds");
        return result;
      });

      expect(yield* attemptsBeforeTheRightCode(4)).toBe(email);
      expect(yield* attemptsBeforeTheRightCode(5)).toBeNull();
      expect(yield* rowCount).toBe(0);
    }).pipe(scenario()),
  );

  it.effect("holds a live challenge through the reissue cooldown, then issues a fresh one", () =>
    Effect.gen(function* () {
      const first = yield* issueOtp(code);
      if (first._tag !== "Issued") return yield* Effect.die(first);
      yield* TestClock.adjust("29 seconds");
      expect(yield* issueOtp(OtpCode.make("111111"))).toEqual({
        _tag: "Pending",
        challengeId: first.challengeId,
      });

      yield* TestClock.adjust("2 seconds");
      const store = yield* EphemeralStore;
      yield* store.consumeOtp({ challengeId: first.challengeId, code });
      const next = yield* issueOtp(OtpCode.make("222222"));
      expect(next._tag).toBe("Issued");
      expect(next).not.toEqual({ _tag: "Issued", challengeId: first.challengeId });
    }).pipe(scenario()),
  );

  it.effect("spends the hourly issue budget, and renews it an hour after the window opened", () =>
    Effect.gen(function* () {
      const store = yield* EphemeralStore;
      for (let issued = 0; issued < 5; issued += 1) {
        const challengeId = yield* issuedChallenge(code);
        yield* store.consumeOtp({ challengeId, code });
        yield* TestClock.adjust("31 seconds");
      }
      expect(yield* issueOtp(code)).toEqual({ _tag: "Exhausted" });

      yield* TestClock.adjust("1 hour");
      expect((yield* issueOtp(code))._tag).toBe("Issued");
    }).pipe(scenario()),
  );

  it.effect("lets exactly one of concurrent OTP consumers across isolates succeed", () =>
    Effect.gen(function* () {
      const left = yield* EphemeralStore;
      const right = yield* EphemeralStore.pipe(Effect.provide(ephemeralIsolate));
      const challengeId = yield* issuedChallenge(code);
      const results = yield* Effect.forEach(
        Array.from({ length: 8 }, (_, index) => (index % 2 === 0 ? left : right)),
        (store) =>
          Effect.all(
            [store.consumeOtp({ challengeId, code }), store.consumeOtp({ challengeId, code })],
            { concurrency: "unbounded" },
          ),
        { concurrency: "unbounded" },
      );
      const consumed = results.flat();
      expect(consumed.filter((result) => result === email)).toHaveLength(1);
      expect(consumed.filter((result) => result === null)).toHaveLength(15);
      expect(yield* rowCount).toBe(0);
    }).pipe(scenario()),
  );

  it.effect("lets exactly one of many concurrent authorization code exchanges succeed", () =>
    Effect.gen(function* () {
      const store = yield* EphemeralStore;
      const grant = {
        userId: UserId.make("user-1"),
        codeChallenge: "challenge",
        client: native,
        expiresAt: (yield* Clock.currentTimeMillis) + OTP_TTL_MS,
      };
      const authorization = yield* store.createAuthorizationGrant(grant);
      const results = yield* Effect.all(
        Array.from({ length: 8 }, () => store.consumeAuthorizationGrant(authorization)),
        { concurrency: "unbounded" },
      );
      expect(results.filter((result) => result !== null)).toEqual([grant]);
      expect(yield* rowCount).toBe(0);
    }).pipe(scenario()),
  );

  it.effect("round-trips OAuth state once", () =>
    Effect.gen(function* () {
      const store = yield* EphemeralStore;
      const input = {
        redirectUri: "https://app.example.com/callback",
        codeChallenge: "challenge",
        client: { _tag: "Native", deviceName: "Front counter" } satisfies AuthClientKind,
        googleCodeVerifier: "google-verifier",
        googleNonce: "google-nonce",
        expiresAt: (yield* Clock.currentTimeMillis) + OTP_TTL_MS,
      };
      const state = yield* store.createOAuthState(input);
      expect(yield* store.consumeOAuthState(state)).toEqual(input);
      expect(yield* store.consumeOAuthState(state)).toBeNull();
    }).pipe(scenario()),
  );

  it.effect("refuses records once they expire", () =>
    Effect.gen(function* () {
      const store = yield* EphemeralStore;
      const challengeId = yield* issuedChallenge(code);
      const authorization = yield* store.createAuthorizationGrant({
        userId: UserId.make("user-1"),
        codeChallenge: "challenge",
        client: native,
        expiresAt: (yield* Clock.currentTimeMillis) + OTP_TTL_MS,
      });
      yield* TestClock.adjust(`${OTP_TTL_MS} millis`);
      expect(yield* store.consumeOtp({ challengeId, code })).toBeNull();
      expect(yield* store.consumeAuthorizationGrant(authorization)).toBeNull();
    }).pipe(scenario()),
  );

  it.effect("does not consume a record as another kind", () =>
    Effect.gen(function* () {
      const store = yield* EphemeralStore;
      const state = yield* store.createOAuthState({
        redirectUri: "https://app.example.com/callback",
        codeChallenge: "challenge",
        client: native,
        googleCodeVerifier: "google-verifier",
        googleNonce: "google-nonce",
        expiresAt: (yield* Clock.currentTimeMillis) + OTP_TTL_MS,
      });
      expect(yield* store.consumeAuthorizationGrant(AuthorizationCode.make(state))).toBeNull();
      expect((yield* store.consumeOAuthState(state))?.redirectUri).toBe(
        "https://app.example.com/callback",
      );
    }).pipe(scenario()),
  );

  it.effect("stores a keyed verifier, never the code or a digest anyone could recompute", () =>
    Effect.gen(function* () {
      const control = yield* AuthTest;
      const challengeId = yield* issuedChallenge(code);
      const row = control.d1.database
        .prepare("SELECT key, payload FROM auth_ephemeral_record WHERE kind = 'otp'")
        .get();
      const stored = `${String(row?.key)} ${String(row?.payload)}`;
      const digest = (value: string) =>
        Effect.promise(async () =>
          Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
        );
      const unkeyed = yield* Effect.forEach(
        [code, `${challengeId}:${code}`, `otp:${challengeId}:${code}`],
        digest,
      );
      expect(stored).not.toContain(challengeId);
      expect(stored).not.toContain(code);
      for (const bytes of unkeyed) {
        expect(stored).not.toContain(bytes.toString("base64url"));
        expect(stored).not.toContain(bytes.toString("hex"));
      }
    }).pipe(scenario()),
  );
});
