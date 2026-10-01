import { decodeAuthenticatedWorkspace, unauthenticatedWorkspace } from "@store/contracts";
import { describe, expect, it } from "vitest";

import { hostAccess } from "../src/host-access";
import type { DeviceWorkspace } from "../src/session/device-workspace";

const unauthenticated = unauthenticatedWorkspace({ isOnline: true });
const authenticated = decodeAuthenticatedWorkspace({
  status: "authenticated",
  isOnline: true,
  user: { id: "u1", name: "A", email: "a@b.c", image: null },
  activeOrganization: { id: "o1", name: "Org", slug: "org", role: "owner" },
  organizations: [{ id: "o1", name: "Org", slug: "org", role: "owner" }],
});

describe("hostAccess", () => {
  const access = hostAccess();

  it("walls unsigned app routes", () => {
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

  it("keeps an authenticated user without an organization on sign-in", () => {
    const authenticatedNoOrg = decodeAuthenticatedWorkspace({
      status: "authenticated",
      isOnline: true,
      user: { id: "u1", name: "A", email: "a@b.c", image: null },
      activeOrganization: null,
      organizations: [],
    });
    expect(
      access.admit({ location: { pathname: "/sign-in" }, snapshot: authenticatedNoOrg }),
    ).toEqual({ _tag: "Allow" });
    expect(access.admit({ location: { pathname: "/" }, snapshot: authenticatedNoOrg })).toEqual({
      _tag: "Redirect",
      to: "/sign-in",
      replace: true,
    });
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

  it("has no inventory scope until an organization is signed in", () => {
    expect(access.inventoryScope(unauthenticated)).toBeNull();
    expect(access.inventoryScope(authenticated)).toEqual({
      organizationId: "o1",
      userId: "u1",
    });
  });
});

describe("hostAccess with a local workspace", () => {
  const authenticatedNoOrg = decodeAuthenticatedWorkspace({
    status: "authenticated",
    isOnline: true,
    user: { id: "u1", name: "A", email: "a@b.c", image: null },
    activeOrganization: null,
    organizations: [],
  });
  const onDevice = (record: DeviceWorkspace | null) =>
    hostAccess({ localWorkspace: { current: () => record } });
  const organizationScope = { organizationId: "o1", userId: "u1" };
  const localScope = { organizationId: "local", userId: "local" };
  const allow = { _tag: "Allow" };
  const toSignIn = { _tag: "Redirect", to: "/sign-in", replace: true };
  const toHome = { _tag: "Redirect", to: "/", replace: true };

  it.each([
    {
      case: "first launch opens the app on this device",
      record: null,
      snapshot: unauthenticated,
      workspace: "Local",
      scope: localScope,
      home: allow,
      signIn: allow,
      choices: ["Local"],
    },
    {
      case: "a local workspace with data opens the app",
      record: { active: "local", localCatalog: "stocked" },
      snapshot: unauthenticated,
      workspace: "Local",
      scope: localScope,
      home: allow,
      signIn: allow,
      choices: ["Local"],
    },
    {
      case: "signing out of an organization falls back to local data",
      record: { active: "organization", localCatalog: "stocked" },
      snapshot: unauthenticated,
      workspace: "Local",
      scope: localScope,
      home: allow,
      signIn: allow,
      choices: ["Local"],
    },
    {
      case: "signing out with an empty local workspace lands on sign-in",
      record: { active: "organization", localCatalog: "empty" },
      snapshot: unauthenticated,
      workspace: "None",
      scope: null,
      home: toSignIn,
      signIn: allow,
      choices: [],
    },
    {
      case: "continuing without an account opens the empty local workspace",
      record: { active: "local", localCatalog: "empty" },
      snapshot: unauthenticated,
      workspace: "Local",
      scope: localScope,
      home: allow,
      signIn: allow,
      choices: ["Local"],
    },
    {
      case: "a signed-in device with no record opens its organization",
      record: null,
      snapshot: authenticated,
      workspace: "Organization",
      scope: organizationScope,
      home: allow,
      signIn: toHome,
      choices: ["Organization"],
    },
    {
      case: "a signed-in device lists this device once it holds data",
      record: { active: "organization", localCatalog: "stocked" },
      snapshot: authenticated,
      workspace: "Organization",
      scope: organizationScope,
      home: allow,
      signIn: toHome,
      choices: ["Organization", "Local"],
    },
    {
      case: "a signed-in user can stay on this device",
      record: { active: "local", localCatalog: "stocked" },
      snapshot: authenticated,
      workspace: "Local",
      scope: localScope,
      home: allow,
      signIn: toHome,
      choices: ["Organization", "Local"],
    },
    {
      case: "an account without an organization works on this device",
      record: { active: "local", localCatalog: "empty" },
      snapshot: authenticatedNoOrg,
      workspace: "Local",
      scope: localScope,
      home: allow,
      signIn: allow,
      choices: ["Local"],
    },
  ] as const)("$case", ({ record, snapshot, workspace, scope, home, signIn, choices }) => {
    const access = onDevice(record);
    expect(access.localWorkspace).toBe(true);
    expect(access.workspace(snapshot)._tag).toBe(workspace);
    expect(access.inventoryScope(snapshot)).toEqual(scope);
    expect(access.admit({ location: { pathname: "/products" }, snapshot })).toEqual(home);
    expect(access.admit({ location: { pathname: "/sign-in" }, snapshot })).toEqual(signIn);
    expect(access.workspaces(snapshot).map((choice) => choice._tag)).toEqual(choices);
  });

  it("offers no local workspace on a host without one", () => {
    const access = hostAccess();
    expect(access.localWorkspace).toBe(false);
    expect(access.workspace(unauthenticated)).toEqual({ _tag: "None" });
    expect(access.workspaces(unauthenticated)).toEqual([]);
    expect(access.workspaces(authenticated).map((choice) => choice._tag)).toEqual(["Organization"]);
  });
});
