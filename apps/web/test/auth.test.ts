import { afterEach, describe, expect, it, vi } from "vitest";

import { WebAuthBroker } from "../src/auth";

describe("WebAuthBroker", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts unauthenticated before the first session lookup", () => {
    const auth = new WebAuthBroker("http://localhost:8787");
    expect(auth.snapshot).toMatchObject({
      status: "unauthenticated",
      user: null,
      activeOrganization: null,
      isOnline: false,
    });
  });

  it("reports when a Clerk token is not accepted as an authenticated session", async () => {
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
    const auth = new WebAuthBroker("http://localhost:8787");

    const snapshot = await auth.adoptSession("clerk-token");

    expect(snapshot).toMatchObject({
      status: "unauthenticated",
      workspaceError: "Your sign-in completed, but the server could not validate the session.",
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
    const auth = new WebAuthBroker("http://localhost:8787");

    const snapshot = await auth.adoptSession("clerk-token");

    expect(snapshot).toMatchObject({
      status: "unauthenticated",
      isOnline: true,
      workspaceError: "This session is not authorized.",
    });
  });
});
