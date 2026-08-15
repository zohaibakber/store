import type { WorkspaceSnapshot } from "@store/contracts";
import { describe, expect, it } from "vitest";

import {
  activateOrganizationSession,
  createAndActivateOrganization,
  preferredClerkOrganizationId,
} from "../../src/lib/clerk-workspace";

const snapshot = (organizations: WorkspaceSnapshot["organizations"]): WorkspaceSnapshot => ({
  status: "authenticated",
  user: { id: "user-1", name: "Zohaib", email: "zohaib@example.com" },
  activeOrganization: null,
  organizations,
  isOnline: true,
});

describe("preferredClerkOrganizationId", () => {
  it("prefers the Clerk organization bound to an existing store id", () => {
    expect(
      preferredClerkOrganizationId(
        snapshot([
          {
            id: "org_new",
            clerkOrganizationId: "org_new",
            name: "Duplicate",
            role: "admin",
          },
          {
            id: "store_tabaaq",
            clerkOrganizationId: "org_tabaaq",
            name: "Tabaaq",
            role: "admin",
          },
        ]),
      ),
    ).toBe("org_tabaaq");
  });

  it("uses the first Clerk organization for a user without a migrated store", () => {
    expect(
      preferredClerkOrganizationId(
        snapshot([
          {
            id: "org_first",
            clerkOrganizationId: "org_first",
            name: "First store",
            role: "admin",
          },
        ]),
      ),
    ).toBe("org_first");
  });
});

describe("createAndActivateOrganization", () => {
  it("activates the new organization before adopting its fresh session", async () => {
    const events: Array<string> = [];

    await expect(
      createAndActivateOrganization({
        name: "Tabaaq",
        createOrganization: async ({ name }) => {
          events.push(`create:${name}`);
          return { id: "org_tabaaq" };
        },
        setActive: async (organizationId) => {
          events.push(`activate:${organizationId}`);
        },
        getToken: async () => {
          events.push("token");
          return "active-token";
        },
        adoptSession: async (token) => {
          events.push(`adopt:${token}`);
        },
      }),
    ).resolves.toEqual({ id: "org_tabaaq" });
    expect(events).toEqual(["create:Tabaaq", "activate:org_tabaaq", "token", "adopt:active-token"]);
  });

  it("does not adopt a session when Clerk returns no active token", async () => {
    let adopted = false;

    await expect(
      createAndActivateOrganization({
        name: "Tabaaq",
        createOrganization: async () => ({ id: "org_tabaaq" }),
        setActive: async () => undefined,
        getToken: async () => null,
        adoptSession: async () => {
          adopted = true;
        },
      }),
    ).rejects.toThrow("could not be activated");
    expect(adopted).toBe(false);
  });
});

describe("activateOrganizationSession", () => {
  it("refreshes the workspace with a token issued after activation", async () => {
    const events: Array<string> = [];

    await activateOrganizationSession({
      organizationId: "org_tabaaq",
      setActive: async (organizationId) => {
        events.push(`activate:${organizationId}`);
      },
      getToken: async () => {
        events.push("token");
        return "tabaaq-token";
      },
      adoptSession: async (token) => {
        events.push(`adopt:${token}`);
      },
    });

    expect(events).toEqual(["activate:org_tabaaq", "token", "adopt:tabaaq-token"]);
  });
});
