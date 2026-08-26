import { decodeAuthenticatedWorkspace, unauthenticatedWorkspace } from "@store/contracts";
import { describe, expect, it } from "vitest";

import { desktopHostAccess } from "../src/host-access";

const unauthenticated = unauthenticatedWorkspace({ isOnline: true });
const authenticated = decodeAuthenticatedWorkspace({
  status: "authenticated",
  isOnline: true,
  user: { id: "u1", name: "A", email: "a@b.c", image: null },
  activeOrganization: { id: "o1", name: "Org", slug: "org", role: "owner" },
  organizations: [{ id: "o1", name: "Org", slug: "org", role: "owner" }],
});

describe("desktopHostAccess", () => {
  const access = desktopHostAccess();

  it("walls unsigned app routes until there is an organization", () => {
    expect(access.admit({ location: { pathname: "/" }, snapshot: unauthenticated })).toEqual({
      _tag: "Redirect",
      to: "/sign-in",
      replace: true,
    });
    expect(access.admit({ location: { pathname: "/sign-in" }, snapshot: unauthenticated })).toEqual({
      _tag: "Allow",
    });
    expect(access.inventoryScope(unauthenticated)).toBeNull();
  });

  it("sends signed-in users away from sign-in", () => {
    expect(access.admit({ location: { pathname: "/sign-in" }, snapshot: authenticated })).toEqual({
      _tag: "Redirect",
      to: "/",
      replace: true,
    });
    expect(access.admit({ location: { pathname: "/products" }, snapshot: authenticated })).toEqual({
      _tag: "Allow",
    });
    expect(access.inventoryScope(authenticated)).toEqual({
      organizationId: "o1",
      userId: "u1",
    });
  });

  it("keeps sign-in chrome-free and the rest of the app in the shell", () => {
    expect(access.chrome({ pathname: "/sign-in" })).toEqual({ _tag: "Bare" });
    expect(access.chrome({ pathname: "/products" })).toEqual({ _tag: "Shell" });
  });
});
