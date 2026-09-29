import { AuthClientError } from "@store/auth";
import { describe, expect, it } from "vitest";

import { authConfigFrom } from "../src/auth/config";
import {
  SESSION_ENDED_NOTICE,
  initialAuthState,
  transition,
  type Account,
  type AuthEvent,
  type AuthState,
} from "../src/auth/model";
import { CODE_LIFETIME_MS, describeFailure, failureFacts } from "../src/auth/problems";
import { statusOf } from "./auth-status";

const account = (organizationId: string | null = "org-1"): Account => ({
  userId: "user-1",
  email: "owner@example.com",
  displayName: "Owner",
  organization:
    organizationId === null
      ? null
      : { id: organizationId, name: "Corner Pharmacy", slug: null, role: "owner" },
});

const remembered = { userId: "user-1", organizationId: "org-1" };

const run = (events: ReadonlyArray<AuthEvent>, from: AuthState = initialAuthState) =>
  events.reduce(transition, from);

describe("session state machine", () => {
  it.each([
    ["signedIn", account(), remembered],
    ["needsOrganization", account(), null],
    ["signedOut", null, remembered],
  ] as const)("restores to %s", (expected, restored, lastOrganization) => {
    const state = run([{ _tag: "Restored", account: restored, lastOrganization }]);
    expect(statusOf(state)).toBe(expected);
  });

  it("confirms only the active organization", () => {
    const signedIn = run([
      { _tag: "Restored", account: null, lastOrganization: null },
      { _tag: "SignedIn", account: account(), lastOrganization: null },
    ]);
    expect(statusOf(signedIn)).toBe("needsOrganization");
    expect(
      statusOf(transition(signedIn, { _tag: "OrganizationConfirmed", organizationId: "org-2" })),
    ).toBe("needsOrganization");
    expect(
      statusOf(transition(signedIn, { _tag: "OrganizationConfirmed", organizationId: "org-1" })),
    ).toBe("signedIn");
  });

  it("never signs in without an organization", () => {
    const state = run([
      { _tag: "Restored", account: account(null), lastOrganization: remembered },
      { _tag: "OrganizationConfirmed", organizationId: "org-1" },
    ]);
    expect(statusOf(state)).toBe("needsOrganization");
  });

  it("keeps the same state object when a refresh changes nothing", () => {
    const state = run([{ _tag: "Restored", account: account(), lastOrganization: remembered }]);
    const next = transition(state, {
      _tag: "AccountRefreshed",
      account: account(),
      lastOrganization: remembered,
    });
    expect(next).toBe(state);
  });

  it("asks again when the server moves the session to another organization", () => {
    const state = run([
      { _tag: "Restored", account: account(), lastOrganization: remembered },
      { _tag: "AccountRefreshed", account: account("org-2"), lastOrganization: remembered },
    ]);
    expect(statusOf(state)).toBe("needsOrganization");
  });

  it("keeps the confirmation through a rename", () => {
    const renamed: Account = {
      userId: "user-1",
      email: "owner@example.com",
      displayName: "Owner",
      organization: { id: "org-1", name: "Renamed", slug: null, role: "owner" },
    };
    const state = run([
      { _tag: "Restored", account: account(), lastOrganization: remembered },
      { _tag: "AccountRefreshed", account: renamed, lastOrganization: null },
    ]);
    expect(statusOf(state)).toBe("signedIn");
  });

  it("ends an active session with a notice and ignores it otherwise", () => {
    const active = run([{ _tag: "Restored", account: account(), lastOrganization: remembered }]);
    expect(transition(active, { _tag: "SessionEnded" })).toEqual({
      _tag: "SignedOut",
      notice: SESSION_ENDED_NOTICE,
    });
    const signedOut: AuthState = { _tag: "SignedOut", notice: null };
    expect(transition(signedOut, { _tag: "SessionEnded" })).toBe(signedOut);
  });
});

describe("auth problems", () => {
  const context = { online: true, now: 1_000_000 };

  it("separates a wrong code from an expired one", () => {
    const facts = failureFacts(
      new AuthClientError({
        operation: "authenticate.otp",
        status: 401,
        code: "INVALID_OTP",
        message: "The code is invalid or has expired.",
      }),
    );
    expect(describeFailure(facts, { ...context, codeIssuedAt: context.now - 1_000 })).toMatchObject(
      {
        kind: "wrongCode",
        field: "code",
      },
    );
    expect(
      describeFailure(facts, { ...context, codeIssuedAt: context.now - CODE_LIFETIME_MS }),
    ).toMatchObject({ kind: "expiredCode", field: "code" });
  });

  it("reports rate limits and ended sessions", () => {
    const limited = failureFacts(
      new AuthClientError({
        operation: "identify",
        status: 429,
        code: "RATE_LIMITED",
        message: "",
      }),
    );
    const ended = failureFacts(
      new AuthClientError({
        operation: "session.refresh",
        status: 401,
        code: "REFRESH_REUSE_DETECTED",
        message: "",
      }),
    );
    expect(describeFailure(limited, context).kind).toBe("rateLimited");
    expect(describeFailure(ended, context).kind).toBe("sessionEnded");
  });

  it("passes the server's message through for other refusals", () => {
    const facts = failureFacts(
      new AuthClientError({
        operation: "google.native",
        status: 409,
        code: "PASSWORD_ACCOUNT_EXISTS",
        message: "Sign in with your password, then connect Google from settings.",
      }),
    );
    expect(describeFailure(facts, context)).toEqual({
      kind: "rejected",
      message: "Sign in with your password, then connect Google from settings.",
    });
  });
});

describe("auth config", () => {
  it("reads the base URLs and hides Google when no client ID is set", () => {
    expect(
      authConfigFrom({
        apiBaseUrl: "https://api.example.test/",
        authBaseUrl: "https://auth.example.test",
        googleWebClientId: "  ",
      }),
    ).toEqual({
      apiBaseUrl: "https://api.example.test",
      authBaseUrl: "https://auth.example.test",
      googleWebClientId: null,
    });
  });
});
