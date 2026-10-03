import { AuthorizationCode, EmailAddress, OtpCode, UserId, type AuthClientKind } from "@store/auth";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { describe, expect, it } from "vitest";

import { AuthCrypto } from "../src/crypto";
import { AuthD1 } from "../src/d1";
import { EphemeralStore } from "../src/ephemeral";
import { authD1 } from "./sqlite-d1";

const PEPPER = Redacted.make("ephemeral-pepper");
const native: AuthClientKind = { _tag: "Native", deviceName: "Front counter" };

const storeOn = (d1: ReturnType<typeof authD1>) => {
  const layer = EphemeralStore.layer(PEPPER).pipe(
    Layer.provide([AuthD1.layer(d1), AuthCrypto.layer]),
  );
  return <A, E>(use: (store: typeof EphemeralStore.Service) => Effect.Effect<A, E>) =>
    Effect.runPromise(EphemeralStore.use(use).pipe(Effect.provide(layer)));
};

const issueOtp = (
  store: typeof EphemeralStore.Service,
  input: Omit<Parameters<typeof EphemeralStore.Service.issueOtp>[0], "metered">,
) =>
  Effect.flatMap(store.issueOtp({ ...input, metered: true }), (issue) =>
    issue._tag === "Issued" ? Effect.succeed(issue.challengeId) : Effect.die(issue),
  );

const rowCount = (d1: ReturnType<typeof authD1>) =>
  Number(
    d1.database
      .prepare("SELECT count(*) AS total FROM auth_ephemeral_record WHERE kind <> 'otp-issuance'")
      .get()?.total ?? -1,
  );

const email = EmailAddress.make("owner@example.com");
const code = OtpCode.make("123456");

describe("ephemeral store on D1", () => {
  it("burns the OTP challenge on the fifth wrong code and not before", async () => {
    const d1 = authD1();
    const run = storeOn(d1);
    const now = Date.now();
    const wrong = OtpCode.make("654321");
    const attemptsBeforeTheRightCode = async (wrongGuesses: number) => {
      const challengeId = await run((store) =>
        issueOtp(store, { email, code, expiresAt: now + 60_000 }),
      );
      for (let guess = 0; guess < wrongGuesses; guess += 1) {
        expect(
          await run((store) => store.consumeOtp({ challengeId, code: wrong, now })),
        ).toBeNull();
      }
      return run((store) => store.consumeOtp({ challengeId, code, now }));
    };

    expect(await attemptsBeforeTheRightCode(4)).toBe(email);
    expect(await attemptsBeforeTheRightCode(5)).toBeNull();
    expect(rowCount(d1)).toBe(0);
  });

  it("lets exactly one of concurrent OTP consumers across isolates succeed", async () => {
    const d1 = authD1();
    const left = storeOn(d1);
    const right = storeOn(d1);
    const now = Date.now();
    const challengeId = await left((store) =>
      issueOtp(store, { email, code, expiresAt: now + 60_000 }),
    );
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        (index % 2 === 0 ? left : right)((store) =>
          Effect.all(
            [
              store.consumeOtp({ challengeId, code, now }),
              store.consumeOtp({ challengeId, code, now }),
            ],
            {
              concurrency: "unbounded",
            },
          ),
        ),
      ),
    );
    const consumed = results.flat();
    expect(consumed.filter((result) => result === email)).toHaveLength(1);
    expect(consumed.filter((result) => result === null)).toHaveLength(15);
    expect(rowCount(d1)).toBe(0);
  });

  it("lets exactly one of many concurrent authorization code exchanges succeed", async () => {
    const d1 = authD1();
    const run = storeOn(d1);
    const now = Date.now();
    const expiresAt = now + 60_000;
    const grant = {
      userId: UserId.make("user-1"),
      codeChallenge: "challenge",
      client: native,
      expiresAt,
    };
    const authorization = await run((store) => store.createAuthorizationGrant(grant));
    const results = await run((store) =>
      Effect.all(
        Array.from({ length: 8 }, () => store.consumeAuthorizationGrant(authorization, now)),
        { concurrency: "unbounded" },
      ),
    );
    const winners = results.filter((result) => result !== null);
    expect(winners).toEqual([grant]);
    expect(rowCount(d1)).toBe(0);
  });

  it("round-trips OAuth state once", async () => {
    const run = storeOn(authD1());
    const now = Date.now();
    const input = {
      redirectUri: "https://app.example.com/callback",
      codeChallenge: "challenge",
      client: { _tag: "Browser" } satisfies AuthClientKind,
      googleCodeVerifier: "google-verifier",
      googleNonce: "google-nonce",
      expiresAt: now + 60_000,
    };
    const state = await run((store) => store.createOAuthState(input));
    const first = await run((store) => store.consumeOAuthState(state, now));
    const second = await run((store) => store.consumeOAuthState(state, now));
    expect(first).toEqual(input);
    expect(second).toBeNull();
  });

  it("refuses expired records", async () => {
    const run = storeOn(authD1());
    const now = Date.now();
    const expiresAt = now + 1_000;
    const challengeId = await run((store) => issueOtp(store, { email, code, expiresAt }));
    const authorization = await run((store) =>
      store.createAuthorizationGrant({
        userId: UserId.make("user-1"),
        codeChallenge: "challenge",
        client: native,
        expiresAt,
      }),
    );
    const otp = await run((store) => store.consumeOtp({ challengeId, code, now: expiresAt }));
    const grant = await run((store) =>
      store.consumeAuthorizationGrant(authorization, expiresAt + 1),
    );
    expect(otp).toBeNull();
    expect(grant).toBeNull();
  });

  it("does not consume a record as another kind", async () => {
    const run = storeOn(authD1());
    const now = Date.now();
    const state = await run((store) =>
      store.createOAuthState({
        redirectUri: "https://app.example.com/callback",
        codeChallenge: "challenge",
        client: native,
        googleCodeVerifier: "google-verifier",
        googleNonce: "google-nonce",
        expiresAt: now + 60_000,
      }),
    );
    const asGrant = await run((store) =>
      store.consumeAuthorizationGrant(AuthorizationCode.make(state), now),
    );
    const asState = await run((store) => store.consumeOAuthState(state, now));
    expect(asGrant).toBeNull();
    expect(asState?.redirectUri).toBe("https://app.example.com/callback");
  });

  it("stores a keyed verifier, never the code or a digest anyone could recompute", async () => {
    const d1 = authD1();
    const run = storeOn(d1);
    const now = Date.now();
    const challengeId = await run((store) =>
      issueOtp(store, { email, code, expiresAt: now + 60_000 }),
    );
    const row = d1.database
      .prepare("SELECT key, payload FROM auth_ephemeral_record WHERE kind = 'otp'")
      .get();
    const stored = `${String(row?.key)} ${String(row?.payload)}`;
    const digest = async (value: string) =>
      Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
    const unkeyed = await Promise.all(
      [code, `${challengeId}:${code}`, `otp:${challengeId}:${code}`].map(digest),
    );
    expect(stored).not.toContain(challengeId);
    expect(stored).not.toContain(code);
    for (const bytes of unkeyed) {
      expect(stored).not.toContain(bytes.toString("base64url"));
      expect(stored).not.toContain(bytes.toString("hex"));
    }
  });
});
