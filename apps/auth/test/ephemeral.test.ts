import { AuthorizationCode, EmailAddress, OtpCode, UserId, type AuthClientKind } from "@store/auth";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { EXPIRED_SWEEP_LIMIT, EphemeralStore, ephemeralStoreLayer } from "../src/ephemeral";
import { authD1 } from "./sqlite-d1";

const PEPPER = "ephemeral-pepper";
const native: AuthClientKind = { _tag: "Native", deviceName: "Front counter" };

const storeOn = (d1: ReturnType<typeof authD1>) => {
  const layer = ephemeralStoreLayer(d1, PEPPER);
  return <A, E>(use: (store: typeof EphemeralStore.Service) => Effect.Effect<A, E>) =>
    Effect.runPromise(EphemeralStore.use(use).pipe(Effect.provide(layer)));
};

const rowCount = (d1: ReturnType<typeof authD1>) =>
  Number(
    d1.database.prepare("SELECT count(*) AS total FROM auth_ephemeral_record").get()?.total ?? -1,
  );

const email = EmailAddress.make("owner@example.com");
const code = OtpCode.make("123456");

describe("ephemeral store on D1", () => {
  it("returns the OTP email once for the right code", async () => {
    const run = storeOn(authD1());
    const now = Date.now();
    const challengeId = await run((store) =>
      store.createOtp({ email, code, expiresAt: now + 60_000 }),
    );
    const first = await run((store) => store.consumeOtp({ challengeId, code, now }));
    const second = await run((store) => store.consumeOtp({ challengeId, code, now }));
    expect(first).toBe(email);
    expect(second).toBeNull();
  });

  it("keeps the OTP challenge after a wrong code", async () => {
    const run = storeOn(authD1());
    const now = Date.now();
    const challengeId = await run((store) =>
      store.createOtp({ email, code, expiresAt: now + 60_000 }),
    );
    const wrong = await run((store) =>
      store.consumeOtp({ challengeId, code: OtpCode.make("654321"), now }),
    );
    const right = await run((store) => store.consumeOtp({ challengeId, code, now }));
    expect(wrong).toBeNull();
    expect(right).toBe(email);
  });

  it("lets exactly one of concurrent OTP consumers across isolates succeed", async () => {
    const d1 = authD1();
    const left = storeOn(d1);
    const right = storeOn(d1);
    const now = Date.now();
    const challengeId = await left((store) =>
      store.createOtp({ email, code, expiresAt: now + 60_000 }),
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
    const challengeId = await run((store) => store.createOtp({ email, code, expiresAt }));
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

  it("stores only peppered digests as keys", async () => {
    const d1 = authD1();
    const run = storeOn(d1);
    const now = Date.now();
    const challengeId = await run((store) =>
      store.createOtp({ email, code, expiresAt: now + 60_000 }),
    );
    const row = d1.database.prepare("SELECT key, payload FROM auth_ephemeral_record").get();
    expect(String(row?.key)).not.toContain(challengeId);
    expect(String(row?.payload)).not.toContain(code);
  });

  it("sweeps a bounded batch of expired rows on write", async () => {
    const d1 = authD1();
    const run = storeOn(d1);
    const now = Date.now();
    const insert = d1.database.prepare(
      "INSERT INTO auth_ephemeral_record (key, kind, payload, expiresAt, createdAt) VALUES (?, 'otp', '{}', ?, ?)",
    );
    const stale = EXPIRED_SWEEP_LIMIT + 5;
    for (let index = 0; index < stale; index += 1) {
      insert.run(`stale-${index}`, now - 1_000, now - 2_000);
    }
    await run((store) => store.createOtp({ email, code, expiresAt: now + 60_000 }));
    expect(rowCount(d1)).toBe(stale - EXPIRED_SWEEP_LIMIT + 1);
  });
});
