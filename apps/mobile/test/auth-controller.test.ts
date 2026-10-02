import { nativeClient } from "@store/auth";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { createAuthController, type SessionVault } from "../src/auth/controller";
import type { LastOrganization, StoredSession } from "../src/auth/model";

const API = "https://api.example.test";
const AUTH = "https://auth.example.test";
const MINUTE = 60_000;
const EMAIL = "otp@example.com";

const json = (body: typeof Schema.Json.Type, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const failure = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status);

const makeServer = () => {
  const refreshTokens = new Set<string>();
  const accessTokens = new Set<string>();
  const organization = { id: "org-1", name: "Owner's Store", role: "owner" };

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const route = `${request.method} ${url.origin === API ? "api" : "auth"}${url.pathname}`;
    const body = request.method === "POST" ? await request.json() : null;

    switch (route) {
      case "POST auth/v1/identify":
        return json({
          _tag: "Otp",
          email: body.email,
          challengeId: "challenge-1",
          developmentCode: "123456",
        });
      case "POST auth/v1/sign-in/otp": {
        if (body.challengeId !== "challenge-1" || body.code !== "123456") {
          return failure(401, "INVALID_OTP", "The code is invalid or has expired.");
        }
        accessTokens.add("access-1");
        refreshTokens.add("session-1.secret");
        return json({
          accessToken: "access-1",
          accessExpiresAt: Date.now() + 10 * MINUTE,
          refreshToken: "session-1.secret",
          refreshExpiresAt: Date.now() + 30 * 24 * 60 * MINUTE,
        });
      }
      case "POST auth/v1/session/logout":
        refreshTokens.delete(body.refreshToken);
        return json({ ok: true });
      case "GET api/api/auth/session": {
        const token = request.headers.get("authorization")?.replace(/^Bearer /u, "") ?? "";
        if (!accessTokens.has(token)) {
          return json({
            status: "unauthenticated",
            user: null,
            activeOrganization: null,
            organizations: [],
            isOnline: true,
          });
        }
        return json({
          status: "authenticated",
          user: { id: "user-1", name: "Otp User", email: EMAIL, image: null },
          activeOrganization: organization,
          organizations: [organization],
          isOnline: true,
        });
      }
      default:
        return failure(404, "NOT_FOUND", route);
    }
  };

  return { fetch, liveRefreshTokens: () => [...refreshTokens] };
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
  return { vault, session: () => session };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("auth controller", () => {
  it("signs out locally and revokes the refresh token", async () => {
    const server = makeServer();
    const storage = makeVault();
    const controller = createAuthController({
      apiBaseUrl: API,
      authBaseUrl: AUTH,
      fetch: server.fetch,
      vault: storage.vault,
      isOnline: async () => true,
      google: null,
      client: nativeClient("Test phone"),
    });
    await controller.start();
    expect(await controller.identify(EMAIL)).toEqual({ _tag: "Routed", route: "Otp" });
    expect(await controller.verifyCode("123456")).toEqual({ _tag: "Done" });
    expect(storage.session()?.tokens.refreshToken).toBe("session-1.secret");
    expect(server.liveRefreshTokens()).toEqual(["session-1.secret"]);

    await controller.signOut();
    await settle();

    expect(controller.getState()).toEqual({ _tag: "SignedOut", notice: null });
    expect(storage.session()).toBeNull();
    expect(server.liveRefreshTokens()).toEqual([]);
  });
});
