import { decodeAuthenticatedWorkspace, unauthenticatedWorkspace } from "@store/contracts";
import { describe, expect, it } from "vitest";

import { browserHostAccess, desktopHostAccess } from "../src/host-access";

const unauthenticated = unauthenticatedWorkspace({ isOnline: true });
const authenticated = decodeAuthenticatedWorkspace({
  status: "authenticated",
  isOnline: true,
  user: { id: "u1", name: "A", email: "a@b.c", image: null },
  activeOrganization: { id: "o1", name: "Org", slug: "org", role: "owner" },
  organizations: [{ id: "o1", name: "Org", slug: "org", role: "owner" }],
});

describe("browserHostAccess", () => {
  const access = browserHostAccess();

  it("walls unsigned app routes and hides guest workspace", () => {
    expect(access.allowsGuestWorkspace).toBe(false);
    expect(access.admit({ location: { pathname: "/" }, snapshot: unauthenticated })).toEqual({
      _tag: "Redirect",
      to: "/sign-in",
      replace: true,
    });
    expect(access.admit({ location: { pathname: "/sign-in" }, snapshot: unauthenticated })).toEqual(
      {
        _tag: "Allow",
      },
    );
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
  });
});

describe("desktopHostAccess", () => {
  const access = desktopHostAccess();

  it("allows unsigned inventory and guest workspace", () => {
    expect(access.allowsGuestWorkspace).toBe(true);
    expect(access.admit({ location: { pathname: "/" }, snapshot: unauthenticated })).toEqual({
      _tag: "Allow",
    });
  });
});
