import { AuthClientError } from "@store/auth";
import { RequestError } from "@store/workspace";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MobileAuthExtra, authConfigFrom } from "../src/auth/config";
import { toSession } from "../src/auth/controller";
import {
  SESSION_ENDED_NOTICE,
  initialAuthState,
  statusOf,
  transition,
  type Account,
  type AuthEvent,
  type AuthState,
} from "../src/auth/model";
import { CODE_LIFETIME_MS, describeFailure, failureFacts } from "../src/auth/problems";

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
  it("restores a remembered organization straight to signed in", () => {
    const state = run([{ _tag: "Restored", account: account(), lastOrganization: remembered }]);
    expect(statusOf(state)).toBe("signedIn");
  });

  it("asks for the organization when this device has not confirmed it", () => {
    const state = run([{ _tag: "Restored", account: account(), lastOrganization: null }]);
    expect(statusOf(state)).toBe("needsOrganization");
  });

  it("restores to signed out without a stored session", () => {
    const state = run([{ _tag: "Restored", account: null, lastOrganization: remembered }]);
    expect(state).toEqual({ _tag: "SignedOut", notice: null });
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

  it("projects the public session", async () => {
    const signOut = async () => undefined;
    const authenticatedFetch: typeof fetch = async () => new Response(null);
    const active = run([{ _tag: "Restored", account: account(), lastOrganization: remembered }]);

    expect(toSession(active, { signOut, authenticatedFetch })).toEqual({
      status: "signedIn",
      userId: "user-1",
      email: "owner@example.com",
      displayName: "Owner",
      organizationId: "org-1",
      organizationName: "Corner Pharmacy",
      authenticatedFetch,
      signOut,
    });
    expect(toSession({ _tag: "SignedOut", notice: null }, { signOut, authenticatedFetch })).toEqual(
      {
        status: "signedOut",
      },
    );
  });
});

describe("auth problems", () => {
  const context = { online: true, now: 1_000_000 };

  it("tells offline apart from an unavailable server", () => {
    const facts = failureFacts(new Error("fetch failed: Network request failed"));
    expect(describeFailure(facts, { ...context, online: false }).kind).toBe("offline");
    expect(describeFailure(facts, context).kind).toBe("unavailable");
  });

  it("treats server errors as unavailable", () => {
    const facts = failureFacts(
      new RequestError({ status: 503, code: "AUTH_UNAVAILABLE", message: "Down." }),
    );
    expect(describeFailure(facts, context).kind).toBe("unavailable");
  });

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

  it("keeps a configured Google web client ID", () => {
    expect(
      authConfigFrom({
        apiBaseUrl: "http://localhost:8787",
        authBaseUrl: "http://localhost:8788",
        googleWebClientId: "123.apps.googleusercontent.com",
      }).googleWebClientId,
    ).toBe("123.apps.googleusercontent.com");
  });

  it("fails fast without base URLs", () => {
    expect(() => Schema.decodeUnknownSync(MobileAuthExtra)({ variant: "development" })).toThrow();
  });
});
