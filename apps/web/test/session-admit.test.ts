import { decodeAuthenticatedWorkspace, unauthenticatedWorkspace } from "@store/contracts";
import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { browserHostAccess } from "../src/host-access";
import { getRouter } from "../src/router";

const unauthenticated = unauthenticatedWorkspace({ isOnline: true });
const authenticated = decodeAuthenticatedWorkspace({
  status: "authenticated",
  isOnline: true,
  user: { id: "u1", name: "A", email: "a@b.c", image: null },
  activeOrganization: { id: "o1", name: "Org", slug: "org", role: "owner" },
  organizations: [{ id: "o1", name: "Org", slug: "org", role: "owner" }],
});

describe("live sessionSnapshot admit", () => {
  it("beforeLoad truth follows router.update, not frozen initialAuth", () => {
    const access = browserHostAccess();
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      initialAuth: { _tag: "Session", snapshot: unauthenticated },
      access,
    });

    expect(
      access.admit({
        location: { pathname: "/" },
        snapshot: router.options.context.sessionSnapshot,
      }),
    ).toEqual({ _tag: "Redirect", to: "/sign-in", replace: true });

    router.update({
      context: {
        ...router.options.context,
        sessionSnapshot: authenticated,
      },
    });

    expect(router.options.context.initialAuth).toMatchObject({
      _tag: "Session",
      snapshot: { status: "unauthenticated" },
    });
    expect(
      access.admit({
        location: { pathname: "/" },
        snapshot: router.options.context.sessionSnapshot,
      }),
    ).toEqual({ _tag: "Allow" });
  });

  it("sessionPending keeps cold-start admit from bouncing to sign-in", () => {
    const access = browserHostAccess();
    const router = getRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      initialAuth: { _tag: "Loading" },
      access,
      sessionPending: true,
    });

    expect(router.options.context.sessionPending).toBe(true);
    expect(router.options.context.sessionSnapshot).toBeNull();
    // beforeLoad short-circuits when sessionPending; admit itself would redirect.
    expect(
      access.admit({
        location: { pathname: "/" },
        snapshot: router.options.context.sessionSnapshot,
      }),
    ).toEqual({ _tag: "Redirect", to: "/sign-in", replace: true });
  });
});
