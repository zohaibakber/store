import { AccessToken, RefreshToken, TokenSet } from "@store/auth";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WebAuthBroker } from "../src/auth";

const tokens = TokenSet.make({
  accessToken: AccessToken.make("access-token"),
  accessExpiresAt: Date.now() + 60_000,
  refreshToken: RefreshToken.make("session.secret"),
  refreshExpiresAt: Date.now() + 120_000,
});

describe("WebAuthBroker", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts unauthenticated before the first session lookup", () => {
    const auth = new WebAuthBroker("http://localhost:8787", "http://localhost:8788");
    expect(auth.snapshot).toMatchObject({
      status: "unauthenticated",
      user: null,
      activeOrganization: null,
      isOnline: false,
    });
  });

  it("reports when an access token is not accepted as an authenticated session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          status: "unauthenticated",
          user: null,
          activeOrganization: null,
          organizations: [],
          isOnline: true,
        }),
      ),
    );
    const auth = new WebAuthBroker("http://localhost:8787", "http://localhost:8788");

    const snapshot = await auth.adoptSession(tokens);

    expect(snapshot).toMatchObject({
      status: "unauthenticated",
      workspaceError: "You signed in, but the server rejected the session.",
    });
  });

  it("keeps session request errors in the workspace snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ message: "This session is not authorized." }, { status: 403 }),
        ),
    );
    const auth = new WebAuthBroker("http://localhost:8787", "http://localhost:8788");

    const snapshot = await auth.adoptSession(tokens);

    expect(snapshot).toMatchObject({
      status: "unauthenticated",
      isOnline: true,
      workspaceError: "This session is not authorized.",
    });
  });
});
