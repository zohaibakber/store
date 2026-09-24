import { TokenSet, makeAuthClient, nativeClient } from "@store/auth";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  createAuthController,
  type AuthController,
  type GoogleIdentity,
  type SessionVault,
} from "../src/auth/controller";
import { statusOf, type LastOrganization, type StoredSession } from "../src/auth/model";

const API = "https://api.example.test";
const AUTH = "https://auth.example.test";
const MINUTE = 60_000;

type Organization = { readonly id: string; name: string };
type User = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly password: string | null;
  organizationId: string;
};

const json = (body: typeof Schema.Json.Type, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const failure = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status);

const makeServer = () => {
  const organizations = new Map<string, Organization>([
    ["org-1", { id: "org-1", name: "Owner's Store" }],
    ["org-2", { id: "org-2", name: "Corner Pharmacy" }],
  ]);
  const users = new Map<string, User>([
    [
      "otp@example.com",
      {
        id: "user-1",
        email: "otp@example.com",
        name: "Otp User",
        password: null,
        organizationId: "org-1",
      },
    ],
  ]);
  const challenges = new Map<string, { email: string; code: string }>();
  const refreshTokens = new Map<string, string>();
  const accessTokens = new Map<string, string>();
  const invitations = new Map<string, string>([["invite-token", "org-2"]]);
  const calls: Array<string> = [];
  let counter = 0;
  let mode: "online" | "offline" | "down" = "online";

  const issue = (email: string) => {
    counter += 1;
    const accessToken = `access-${counter}`;
    const refreshToken = `session-${counter}.secret`;
    accessTokens.set(accessToken, email);
    refreshTokens.set(refreshToken, email);
    return {
      accessToken,
      accessExpiresAt: Date.now() + 10 * MINUTE,
      refreshToken,
      refreshExpiresAt: Date.now() + 30 * 24 * 60 * MINUTE,
    };
  };

  const bearerUser = (request: Request) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer /u, "") ?? "";
    const email = accessTokens.get(token);
    return email === undefined ? null : (users.get(email) ?? null);
  };

  const snapshot = (user: User) => {
    const organization = organizations.get(user.organizationId);
    const membership = organization && {
      id: organization.id,
      name: organization.name,
      slug: null,
      role: "owner",
    };
    return {
      status: "authenticated",
      user: { id: user.id, name: user.name, email: user.email, image: null },
      activeOrganization: membership ?? null,
      organizations: membership ? [membership] : [],
      isOnline: true,
    };
  };

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const route = `${request.method} ${url.origin === API ? "api" : "auth"}${url.pathname}`;
    calls.push(route);
    const body = request.method === "POST" ? await request.json() : null;

    switch (route) {
      case "POST auth/v1/identify": {
        const user = users.get(body.email);
        if (user === undefined) return json({ _tag: "Registration", email: body.email });
        if (user.password !== null) return json({ _tag: "Password", email: body.email });
        counter += 1;
        const challengeId = `challenge-${counter}`;
        challenges.set(challengeId, { email: body.email, code: "123456" });
        return json({ _tag: "Otp", email: body.email, challengeId, developmentCode: "123456" });
      }
      case "POST auth/v1/sign-in/otp": {
        const challenge = challenges.get(body.challengeId);
        if (challenge === undefined || challenge.code !== body.code) {
          return failure(401, "INVALID_OTP", "The code is invalid or has expired.");
        }
        challenges.delete(body.challengeId);
        return json(issue(challenge.email));
      }
      case "POST auth/v1/sign-up/password": {
        users.set(body.email, {
          id: "user-new",
          email: body.email,
          name: body.name,
          password: body.password,
          organizationId: "org-1",
        });
        return json(issue(body.email));
      }
      case "POST auth/v1/oauth/google/native":
        return body.idToken === "google-id-token"
          ? json(issue("otp@example.com"))
          : failure(401, "INVALID_GOOGLE_IDENTITY", "Google sign-in could not be verified.");
      case "POST auth/v1/session/refresh": {
        const email = refreshTokens.get(body.refreshToken);
        if (email === undefined) {
          return failure(401, "INVALID_REFRESH_TOKEN", "The session has expired.");
        }
        refreshTokens.delete(body.refreshToken);
        return json(issue(email));
      }
      case "POST auth/v1/session/logout":
        refreshTokens.delete(body.refreshToken);
        return json({ ok: true });
      case "POST auth/v1/organization": {
        const user = bearerUser(request);
        if (user === null) return failure(401, "UNAUTHENTICATED", "Sign in to continue.");
        if (body._tag === "AcceptInvitation") {
          const organizationId = invitations.get(body.token);
          if (organizationId === undefined) {
            return failure(404, "INVITATION_NOT_FOUND", "This invitation is no longer valid.");
          }
          user.organizationId = organizationId;
          const organization = organizations.get(organizationId);
          if (organization === undefined) return failure(404, "NOT_FOUND", "No store.");
          return json({
            _tag: "Joined",
            organization: {
              id: organization.id,
              name: organization.name,
              slug: null,
              role: "member",
            },
          });
        }
        if (body._tag === "UpdateOrganization") {
          const target = organizations.get(body.organizationId);
          if (target === undefined) return failure(404, "NOT_FOUND", "No store.");
          target.name = body.name;
          return json({
            _tag: "Updated",
            organization: { id: body.organizationId, name: body.name, slug: null, role: "owner" },
          });
        }
        return failure(400, "UNSUPPORTED", "Unsupported.");
      }
      case "GET api/api/auth/session": {
        const user = bearerUser(request);
        if (user === null) {
          return json({
            status: "unauthenticated",
            user: null,
            activeOrganization: null,
            organizations: [],
            isOnline: true,
          });
        }
        return json(snapshot(user));
      }
      case "GET api/api/sync/pull":
        return bearerUser(request) === null
          ? failure(401, "UNAUTHENTICATED", "Sign in to continue.")
          : json({ ok: true });
      default:
        return failure(404, "NOT_FOUND", route);
    }
  };

  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (mode === "offline") throw new TypeError("Network request failed");
    if (mode === "down") return failure(503, "AUTH_UNAVAILABLE", "Down.");
    return handle(new Request(input, init));
  };

  return {
    fetch,
    calls,
    setMode: (next: typeof mode) => {
      mode = next;
    },
    revokeEverything: () => {
      refreshTokens.clear();
      accessTokens.clear();
    },
    liveRefreshTokens: () => [...refreshTokens.keys()],
  };
};

const makeVault = () => {
  let session: StoredSession | null = null;
  let last: LastOrganization | null = null;
  const vault: SessionVault = {
    load: async () => session,
    save: async (next) => {
      session = next;
    },
    clear: async () => {
      session = null;
    },
    loadLastOrganization: async () => last,
    saveLastOrganization: async (next) => {
      last = next;
    },
  };
  return { vault, session: () => session, last: () => last };
};

const makeController = (
  server: ReturnType<typeof makeServer>,
  vault: SessionVault,
  options: { readonly online?: boolean; readonly google?: GoogleIdentity | null } = {},
) =>
  createAuthController({
    apiBaseUrl: API,
    authBaseUrl: AUTH,
    fetch: server.fetch,
    authClient: makeAuthClient({ baseUrl: AUTH, fetch: server.fetch }),
    vault,
    isOnline: async () => options.online ?? true,
    google: options.google ?? null,
    client: nativeClient("Test phone"),
  });

const status = (controller: AuthController) => statusOf(controller.getState());

const signInWithCode = async (controller: AuthController) => {
  expect(await controller.identify(" OTP@example.com ")).toEqual({ _tag: "Routed", route: "Otp" });
  expect(await controller.verifyCode("123456")).toEqual({ _tag: "Done" });
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("auth controller", () => {
  it("signs in with a code, asks for the store once, and remembers it", async () => {
    const server = makeServer();
    const storage = makeVault();
    const controller = makeController(server, storage.vault);
    await controller.start();
    expect(status(controller)).toBe("signedOut");

    await controller.identify("otp@example.com");
    const wrong = await controller.verifyCode("000000");
    expect(wrong).toMatchObject({ _tag: "Failed", problem: { kind: "wrongCode", field: "code" } });
    expect(await controller.verifyCode("123456")).toEqual({ _tag: "Done" });
    expect(status(controller)).toBe("needsOrganization");
    expect(controller.getFlow()).toBeNull();

    expect(await controller.confirmOrganization({})).toEqual({ _tag: "Done" });
    expect(status(controller)).toBe("signedIn");
    expect(storage.session()?.account.organization?.id).toBe("org-1");
    expect(storage.last()).toEqual({ userId: "user-1", organizationId: "org-1" });

    server.setMode("offline");
    const restarted = makeController(server, storage.vault, { online: false });
    await restarted.start();
    expect(status(restarted)).toBe("signedIn");
  });

  it("renames the store while confirming it", async () => {
    const server = makeServer();
    const storage = makeVault();
    const controller = makeController(server, storage.vault);
    await controller.start();
    await signInWithCode(controller);

    const tooShort = await controller.confirmOrganization({ name: "A" });
    expect(tooShort).toMatchObject({ problem: { field: "organizationName" } });

    expect(await controller.confirmOrganization({ name: "Main Street Pharmacy" })).toEqual({
      _tag: "Done",
    });
    const state = controller.getState();
    expect(state._tag === "Active" && state.account.organization?.name).toBe(
      "Main Street Pharmacy",
    );
    expect(status(controller)).toBe("signedIn");
  });

  it("joins another store with an invitation", async () => {
    const server = makeServer();
    const storage = makeVault();
    const controller = makeController(server, storage.vault);
    await controller.start();
    await signInWithCode(controller);

    const missing = await controller.joinOrganization("nope");
    expect(missing).toMatchObject({ _tag: "Failed", problem: { kind: "rejected" } });

    expect(await controller.joinOrganization(" invite-token ")).toEqual({ _tag: "Done" });
    expect(status(controller)).toBe("signedIn");
    expect(storage.last()).toEqual({ userId: "user-1", organizationId: "org-2" });
  });

  it("creates an account for a new email", async () => {
    const server = makeServer();
    const controller = makeController(server, makeVault().vault);
    await controller.start();

    expect(await controller.identify("new@example.com")).toEqual({
      _tag: "Routed",
      route: "Registration",
    });
    expect(await controller.createAccount({ name: "New", password: "short" })).toMatchObject({
      problem: { field: "password" },
    });
    expect(
      await controller.createAccount({ name: " New Owner ", password: "long enough pass" }),
    ).toEqual({ _tag: "Done" });
    expect(status(controller)).toBe("needsOrganization");
  });

  it("reports offline and unavailable separately", async () => {
    const server = makeServer();
    const offline = makeController(server, makeVault().vault, { online: false });
    await offline.start();

    server.setMode("offline");
    expect(await offline.identify("otp@example.com")).toMatchObject({
      problem: { kind: "offline" },
    });

    const reachable = makeController(server, makeVault().vault, { online: true });
    await reachable.start();
    expect(await reachable.identify("otp@example.com")).toMatchObject({
      problem: { kind: "unavailable" },
    });

    server.setMode("down");
    expect(await reachable.identify("otp@example.com")).toMatchObject({
      problem: { kind: "unavailable" },
    });
  });

  it("ends the session when the refresh token is rejected", async () => {
    const server = makeServer();
    const storage = makeVault();
    const controller = makeController(server, storage.vault);
    await controller.start();
    await signInWithCode(controller);
    await controller.confirmOrganization({});

    server.revokeEverything();
    const response = await controller.authenticatedFetch(`${API}/api/sync/pull`);
    await settle();

    expect(response.status).toBe(401);
    expect(controller.getState()).toEqual({
      _tag: "SignedOut",
      notice: "Your session ended. Sign in again.",
    });
    expect(storage.session()).toBeNull();
  });

  it("shares one refresh after a restart with an expired access token", async () => {
    const server = makeServer();
    const storage = makeVault();
    const first = makeController(server, storage.vault);
    await first.start();
    await signInWithCode(first);
    await first.confirmOrganization({});
    const stored = storage.session();
    const refreshToken = stored?.tokens.refreshToken;
    if (stored === null || refreshToken === undefined) throw new Error("No stored session.");
    await storage.vault.save({
      version: 1,
      account: stored.account,
      tokens: TokenSet.make({
        accessToken: stored.tokens.accessToken,
        accessExpiresAt: Date.now() - MINUTE,
        refreshToken,
        refreshExpiresAt: stored.tokens.refreshExpiresAt,
      }),
    });

    const restarted = makeController(server, storage.vault);
    await restarted.start();
    expect(status(restarted)).toBe("signedIn");
    const responses = await Promise.all([
      restarted.authenticatedFetch(`${API}/api/sync/pull`),
      restarted.authenticatedFetch("/api/sync/pull"),
    ]);
    await settle();

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(server.calls.filter((call) => call === "POST auth/v1/session/refresh")).toHaveLength(1);
    expect(storage.session()?.tokens.refreshToken).not.toBe(stored.tokens.refreshToken);
    expect(status(restarted)).toBe("signedIn");
  });

  it("signs out locally and revokes the refresh token", async () => {
    const server = makeServer();
    const storage = makeVault();
    const controller = makeController(server, storage.vault);
    await controller.start();
    await signInWithCode(controller);

    await controller.signOut();
    await settle();

    expect(controller.getState()).toEqual({ _tag: "SignedOut", notice: null });
    expect(storage.session()).toBeNull();
    expect(server.liveRefreshTokens()).toEqual([]);
  });

  it("exchanges a Google ID token and treats a cancelled picker as no error", async () => {
    const server = makeServer();
    const cancelled = makeController(server, makeVault().vault, {
      google: {
        requestIdToken: async () => ({ _tag: "Cancelled" }),
        forget: async () => undefined,
      },
    });
    await cancelled.start();
    expect(cancelled.googleAvailable).toBe(true);
    expect(await cancelled.signInWithGoogle()).toEqual({ _tag: "Cancelled" });
    expect(status(cancelled)).toBe("signedOut");

    const hidden = makeController(server, makeVault().vault);
    expect(hidden.googleAvailable).toBe(false);

    const google = makeController(server, makeVault().vault, {
      google: {
        requestIdToken: async () => ({ _tag: "Token", idToken: "google-id-token" }),
        forget: async () => undefined,
      },
    });
    await google.start();
    expect(await google.signInWithGoogle()).toEqual({ _tag: "Done" });
    expect(status(google)).toBe("needsOrganization");
  });
});
