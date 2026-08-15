import { describe, expect, it } from "vitest";

import {
  mapClerkOrganizationRole,
  resolveStoreOrganizationId,
  type OrganizationBinding,
  type OrganizationBindingStore,
} from "../src/store-organization";

const memoryStore = () => {
  const byClerk = new Map<string, OrganizationBinding>();

  const commitBinding: OrganizationBindingStore["putBinding"] = async (input) => {
    byClerk.set(input.clerkOrganizationId, {
      clerkOrganizationId: input.clerkOrganizationId,
      storeOrganizationId: input.storeOrganizationId,
    });
  };
  let putBinding = commitBinding;

  const store: OrganizationBindingStore = {
    getByClerkOrganizationId: async (id) => byClerk.get(id) ?? null,
    putBinding: (input) => putBinding(input),
  };

  return {
    store,
    commitBinding,
    setPutBinding: (next: OrganizationBindingStore["putBinding"]) => {
      putBinding = next;
    },
  };
};

describe("resolveStoreOrganizationId", () => {
  it("reuses an existing Clerk-to-store binding", async () => {
    const { store } = memoryStore();
    await store.putBinding({
      clerkOrganizationId: "org_clerk",
      storeOrganizationId: "org_legacy",
      clerkUserId: "user_1",
      email: "owner@example.com",
    });

    await expect(
      resolveStoreOrganizationId(store, {
        clerkOrganizationId: "org_clerk",
        clerkUserId: "user_1",
        email: "owner@example.com",
      }),
    ).resolves.toEqual({
      clerkOrganizationId: "org_clerk",
      storeOrganizationId: "org_legacy",
      source: "existing",
    });
  });

  it("uses the Clerk organization id for a new organization", async () => {
    const { store } = memoryStore();

    await expect(
      resolveStoreOrganizationId(store, {
        clerkOrganizationId: "org_new",
        clerkUserId: "user_2",
        email: " New@example.com ",
      }),
    ).resolves.toEqual({
      clerkOrganizationId: "org_new",
      storeOrganizationId: "org_new",
      source: "new",
    });
  });

  it("returns a binding created by a concurrent request", async () => {
    const { store, setPutBinding, commitBinding } = memoryStore();
    setPutBinding(async (input) => {
      await commitBinding({ ...input, storeOrganizationId: "org_existing" });
      throw new Error("UNIQUE constraint failed: clerk_org_binding.clerkOrganizationId");
    });

    await expect(
      resolveStoreOrganizationId(store, {
        clerkOrganizationId: "org_clerk_race",
        clerkUserId: "user_1",
        email: "owner@example.com",
      }),
    ).resolves.toEqual({
      clerkOrganizationId: "org_clerk_race",
      storeOrganizationId: "org_existing",
      source: "existing",
    });
  });

  it("does not hide an insert failure when no binding was created", async () => {
    const { store, setPutBinding } = memoryStore();
    const failure = new Error("D1 unavailable");
    setPutBinding(async () => {
      throw failure;
    });

    await expect(
      resolveStoreOrganizationId(store, {
        clerkOrganizationId: "org_new",
        clerkUserId: "user_1",
        email: "owner@example.com",
      }),
    ).rejects.toBe(failure);
  });
});

describe("mapClerkOrganizationRole", () => {
  it("maps Clerk admin to the desktop owner role", () => {
    expect(mapClerkOrganizationRole("org:admin")).toBe("owner");
    expect(mapClerkOrganizationRole("org:member")).toBe("member");
    expect(mapClerkOrganizationRole(undefined)).toBe("member");
  });
});
