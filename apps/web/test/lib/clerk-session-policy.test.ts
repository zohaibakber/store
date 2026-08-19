import {
  decodeAuthenticatedWorkspace,
  unauthenticatedWorkspace,
  type WorkspaceSnapshot,
} from "@store/contracts";
import { expect, test } from "vitest";

import { clerkWorkspaceSyncAction, workspaceScreen } from "@/lib/clerk-session-policy";

const authenticated = (organizationId: string | null): WorkspaceSnapshot =>
  decodeAuthenticatedWorkspace({
    status: "authenticated",
    user: { id: "user-1", name: "Owner", email: "owner@example.com" },
    activeOrganization: organizationId
      ? { id: organizationId, name: "Store", role: "owner" }
      : null,
    organizations: [],
    isOnline: false,
    workspaceError: null,
  });

const unauthenticated: WorkspaceSnapshot = unauthenticatedWorkspace({
  isOnline: false,
  workspaceError: null,
});

test("opens the catalog from a persisted workspace even when Clerk is still loading", () => {
  expect(
    workspaceScreen({
      snapshot: authenticated("org-1"),
      clerkConfigured: true,
      clerkLoaded: false,
      online: false,
    }),
  ).toBe("shell");
});

test("does not wait on Clerk offline when there is no local session", () => {
  expect(
    workspaceScreen({
      snapshot: unauthenticated,
      clerkConfigured: true,
      clerkLoaded: false,
      online: false,
    }),
  ).toBe("auth");
});

test("waits for Clerk online until the first session exists", () => {
  expect(
    workspaceScreen({
      snapshot: unauthenticated,
      clerkConfigured: true,
      clerkLoaded: false,
      online: true,
    }),
  ).toBe("loading");
});

test("keeps a local session when Clerk reports signed-out offline", () => {
  expect(clerkWorkspaceSyncAction({ isLoaded: true, isSignedIn: false, online: false })).toBe(
    "idle",
  );
});

test("clears the workspace only after Clerk confirms sign-out while online", () => {
  expect(clerkWorkspaceSyncAction({ isLoaded: true, isSignedIn: false, online: true })).toBe(
    "clear",
  );
});
