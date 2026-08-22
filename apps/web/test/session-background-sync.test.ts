import { AccessToken, RefreshToken, TokenSet, type TokenSet as TokenSetType } from "@store/auth";
import { decodeAuthenticatedWorkspace, type WorkspaceSnapshot } from "@store/contracts";
import { describe, expect, it, vi } from "vitest";

import type { AuthSessionBridge } from "../src/lib/auth";
import { withSessionBackgroundSync } from "../src/session-background-sync";

const tokens: TokenSetType = TokenSet.make({
  accessToken: AccessToken.make("access-token"),
  accessExpiresAt: Date.now() + 60_000,
  refreshToken: RefreshToken.make("refresh-token"),
  refreshExpiresAt: Date.now() + 120_000,
});

const authenticated: WorkspaceSnapshot = decodeAuthenticatedWorkspace({
  status: "authenticated",
  user: { id: "user-1", name: "Owner", email: "owner@example.com" },
  activeOrganization: {
    id: "organization-1",
    name: "Store",
    role: "owner",
  },
  organizations: [],
  isOnline: true,
});

const makeBridge = (): AuthSessionBridge => ({
  getSession: () => Promise.resolve(authenticated),
  adoptSession: () => Promise.resolve(authenticated),
  renewSession: () => Promise.resolve(authenticated),
  signOut: () => Promise.resolve(),
  organizationRoster: () => Promise.reject(new Error("Not used by this test")),
  organize: () => Promise.reject(new Error("Not used by this test")),
  onSessionChange: () => () => undefined,
});

describe("session background sync", () => {
  it.each([
    ["session adoption", (bridge: AuthSessionBridge) => bridge.adoptSession(tokens)],
    ["session renewal", (bridge: AuthSessionBridge) => bridge.renewSession()],
  ])("schedules sync after successful %s", async (_label, activate) => {
    const scheduled: Array<() => void> = [];
    const startSync = vi.fn(() => Promise.resolve());
    const bridge = withSessionBackgroundSync({
      bridge: makeBridge(),
      schedule: (work) => scheduled.push(work),
      startSync,
    });

    await expect(activate(bridge)).resolves.toEqual(authenticated);
    expect(startSync).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);

    scheduled[0]?.();
    expect(startSync).toHaveBeenCalledOnce();
  });

  it("does not schedule sync when session adoption fails", async () => {
    const scheduled: Array<() => void> = [];
    const failed = makeBridge();
    const bridge = withSessionBackgroundSync({
      bridge: {
        ...failed,
        adoptSession: () => Promise.reject(new Error("Session rejected")),
      },
      schedule: (work) => scheduled.push(work),
      startSync: () => Promise.resolve(),
    });

    await expect(bridge.adoptSession(tokens)).rejects.toThrow("Session rejected");
    expect(scheduled).toHaveLength(0);
  });
});
