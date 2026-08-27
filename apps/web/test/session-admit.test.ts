import { decodeAuthenticatedWorkspace, unauthenticatedWorkspace } from "@store/contracts";
import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { hostAccess } from "../src/host-access";
import { createAppCatalogLifetime } from "../src/lib/inventory/lifetime";
import { makeReplayChannel } from "../src/replay-channel";
import { getRouter } from "../src/router";
import type { WorkspaceSession } from "../src/session/workspace-session";

const unauthenticated = unauthenticatedWorkspace({ isOnline: true });
const authenticated = decodeAuthenticatedWorkspace({
  status: "authenticated",
  isOnline: true,
  user: { id: "u1", name: "A", email: "a@b.c", image: null },
  activeOrganization: { id: "o1", name: "Org", slug: "org", role: "owner" },
  organizations: [{ id: "o1", name: "Org", slug: "org", role: "owner" }],
});

const routerFor = (session: ReturnType<typeof makeReplayChannel<WorkspaceSession>>) =>
  getRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    session,
    catalog: createAppCatalogLifetime(),
    access: hostAccess(),
  });

describe("live session admit", () => {
  it("beforeLoad truth follows the session channel, not a frozen bootstrap copy", () => {
    const access = hostAccess();
    const session = makeReplayChannel<WorkspaceSession>();
    session.publish({ _tag: "Steady", snapshot: unauthenticated });
    const router = routerFor(session);

    expect(
      access.admit({
        location: { pathname: "/" },
        snapshot: router.options.context.session.current()?.snapshot ?? null,
      }),
    ).toEqual({ _tag: "Redirect", to: "/sign-in", replace: true });

    session.publish({ _tag: "Steady", snapshot: authenticated });

    expect(
      access.admit({
        location: { pathname: "/" },
        snapshot: router.options.context.session.current()?.snapshot ?? null,
      }),
    ).toEqual({ _tag: "Allow" });
  });

  it("admits the destination snapshot while Switching, not a pending flag", () => {
    const access = hostAccess();
    const session = makeReplayChannel<WorkspaceSession>();
    session.publish({ _tag: "Switching", snapshot: unauthenticated });
    const router = routerFor(session);

    expect(router.options.context.session.current()?._tag).toBe("Switching");
    expect(
      access.admit({
        location: { pathname: "/" },
        snapshot: router.options.context.session.current()?.snapshot ?? null,
      }),
    ).toEqual({ _tag: "Redirect", to: "/sign-in", replace: true });
    expect(
      access.admit({
        location: { pathname: "/sign-in" },
        snapshot: router.options.context.session.current()?.snapshot ?? null,
      }),
    ).toEqual({ _tag: "Allow" });
  });
});
